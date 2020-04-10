#!/usr/bin/env node

/**
 * Spider tools for cli.
 * run `spider --help` for more infomation.
 * 
 * * spider extract https://www.cnbeta.com/ '.items-area .item dl > dt > a => %text : @href' -cE
 * * spider extract https://www.cnbeta.com/ '.items-area .item dl > dt > a'
 *    default is %html
 */
const util = require('util');
const fs = require('fs-extra');
const axios = require('axios');
const cmdr = require('commander');
const path = require('path');
const os = require('os');
const {uniq, isArray, isString, flatten} = require('lodash');
const {mapLimit} = require('promise-async');
const pretty = require('pretty');
const cheerio = require('cheerio');
const crypto = require('crypto');
const entities = new (require('html-entities').XmlEntities)();
const stdin = require('./stdin');
const log = require('./log');
const cfgStore = require('./config')('~/.spider.cli.json');
const dir = s => path.join(__dirname, s);

const REGEX_HTTP_URL = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
const REGEX_ANY_URL = /[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
const REGEX_IMG_TAG = /<img.*?src="(.*?)"[^>]+>/g;
const userAgents = {
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36',
  googlebot: 'Googlebot/2.1 (+http://www.googlebot.com/bot.html)',
  default: 'CURL'
};

const isURL = s => s && (s.startsWith('http:') || s.startsWith('https:') || s.startsWith('ftp:'));
const unescapeOrNot = s => cmdr.unescape ? entities.decode(s) : s;
const prettyJSONOrNot = s => cmdr.format ? JSON.stringify(JSON.parse(s), null, 2) : s;
const prettyHTMLOrNot = s => cmdr.format ? pretty(s) : s;

cmdr.version('0.1.0');
cmdr.option('-c, --cache [cachePath]', 'use cache, if a cache path is specified, use that, other wise, use a path of (os tmp path + base64(url));')
cmdr.option('-e --expire [expireTime]', 'default expire time is 1day, if not specified', 86400)
cmdr.option('-u, --unique', 'unique')
cmdr.option('-f, --format', 'prettify html')
cmdr.option('-t, --timeout <millsec>', 'set fetch timeout')
cmdr.option('-o --save <save-path>')
cmdr.option('-a, --asc', 'sort asc')
cmdr.option('-d, --dasc', 'sort dasc')
cmdr.option('-v, --log [loglevel]', 'log messages levels:debug/warn/error', 'silent')
cmdr.option('-D, --decode-entities', 'decode html entities')
cmdr.option('-H, --html', 'output as html')
cmdr.option('-A, --user-agent', 'user agent: chrome/firefox/safari')
cmdr.option('-p, --parallel <n>', 'jobs run sequentially at default, use this options to fetch urls parallely at most <n> jobs');

cmdr.command('config <getset> <key> [value]')
  .description('get or set configuration, the default configuration is store at ~/.spider.cli.json')
  .action((getset, key, value) => {
    if (getset === 'get') {
      console.log(cfgStore.data[key]);
    } else if (getset === 'set') {
      cfgStore.data[key] = value;
      cfgStore.save();
    } else {
      throw new Error('Wrong Param');
    }
  });

cmdr.command('expands <url>').alias('e')
  .description('Expands url pattern [1..100]')
  .action(async url => {
    expandUrlList(url).map(u => console.log(u));
  });

cmdr.command('get [url]').alias('g')
  .description('Get resource')
  .action(async url => {
    let urls = await getUrls(url);
    await runsWithOptions(urls, {flatten: true},
      async (url) => {
        log.debug('Get', url);
        const data = await fetchWithOptions(url);
        if (cmdr.save) {
          const savePath = path.join(cmdr.save, encodeURIComponent(url.split('/').pop()));
          if (!data.pipe) {
            log.error('no pipe', url);
          }
          data.pipe(fs.createWriteStream(savePath));
        } else {
          console.log(data);
        }
      }
    );
  });

cmdr.command('links [url]').alias('l')
  .description('Extract links from webpage')
  .action(async url => {
    let urls = await getUrls(url);
    let links = await runsWithOptions(urls, {flatten: true},
      async (url) => {
        const html = await fetchWithOptions(url);
        return html ? html.match(REGEX_HTTP_URL) : null;
      }
    );

    links = convertListWithOptions(links);
    links = links.filter(_ => !!_);

    if (cmdr.html) {
      let html = template('html');
      let a = template('a');
      const li = s => template('li')({text: a({ href: s, text: s })});
      console.log(pretty(html({ main: links.map(li) })));
    } else {
      links.map(u => console.log(u));
    }
  });

cmdr.command('images <url>').alias('img')
  .description('Extract images from webpage')
  .action(async url => {
    const urls = expandUrlList(url);

    let imgs = await runsWithOptions(urls, {flatten: true}, async url => {
      const html = await fetchWithOptions(url);
      return html ? html.match(REGEX_IMG_TAG) : null;
    });

    imgs = convertListWithOptions(imgs);

    if (cmdr.html) {
      const li = template('li');
      console.log(
        pretty(
          template('html')({
            main: imgs.map(img => li({text: img}))
          })
        )
      );
    } else {
      imgs.map(u => console.log(u));
    }
  });

cmdr.command('extract <pattern> [url]').alias('ext')
  .description('Extract html page base on the selector pattern')
  .action(async (pattern, url) => {
    const urls = await getUrls(url);
    await runsWithOptions(urls, {}, async url => {
      const html = await fetchWithOptions(url);
      const results = parseHtmlWithOption(url, html, pattern).filter(x => !!x);
      for (const r of results) {
        console.log(r);
      }
    });
  });

cfgStore.load();

cmdr.parse(process.argv);

log.level = cmdr.log;

async function getUrls(url) {
  if (!url) {
    const urls = flatten((await stdin()).split('\n').map(expandUrlList));
    return urls.filter(isURL);
  } else {
    return expandUrlList(url).filter(isURL);
  }
}

function template(tmplName) {
  const tmpl = fs.readFileSync(dir(`tmpl/${tmplName}.html`)).toString();
  return function(args) {
    let str = tmpl;
    for (const k in args) {
      let v = args[k];
      if (isArray(v)) {
        v = v.join('\n');
      }
      str = str.replace(`{${k}}`, v);
    }
    return str;
  }
}

function expandUrlList(url) {
  const range = url.match(/\[(\d+?)\.\.(\d+?)]/);
  if (!range) {
    return [url];
  }
  const [all,left,right] = range;
  const urls = [];
  for (let i=Number(left); i<=Number(right); i++) {
    urls.push(url.replace(all, i));
  }
  return urls;
}

function convertListWithOptions(list) {
  if (cmdr.unique) {
    list = uniq(list);
  }
  if (cmdr.asc) {
    list = list.sort();
  }
  if (cmdr.desc) {
    list = list.sort((a,b) => a > b);
  }
  return list;
}

async function runsWithOptions(list, opt, runner) {
  const nconcur = Number(cmdr.parallel) || 0;
  let results = [];

  if (nconcur) {
    results = await mapLimit(list, nconcur, async (item, callback) =>
      callback(null, await runner(item))
    );
  } else {
    for (const item of list) {
      results.push(await runner(item));
    }
  }
  if (opt.flatten) {
    results = flatten(results);
  }
  return results;
}

function parseHtmlWithOption(mainURL, html, pattern) {
  // let domain = mainURL.split('/').slice(0,3).join('/');
  // const fixLink = s => s ? s.startsWith('//') ? (domain + '/' + s) : s : s;

  let [selector, formatter] = pattern.split('=>').map(s => s.trim());
  const $ = cheerio.load(html);
  const results = [];
  if (!formatter) {
    formatter = '%html';
  }
  for (const el of $(selector).toArray().map($)) {
    const res = format(formatter, {
      '@(.+)': (_, s) => unescapeOrNot(el.attr(s)) || '',
      '%html': () => unescapeOrNot(prettyHTMLOrNot($.html(el))),
      '%text': () => unescapeOrNot(el.text()),
      '%element': () => util.format(el[0]),
      '%json': () => el[0].children.map(_ => prettyJSONOrNot(_.data)).join('\n')
    });
    results.push(res);
  }
  
  return results;

  function format(s, replacements) {
    for (const repl in replacements) {
      s = s.replace(new RegExp(repl, 'g'), (...args) => replacements[repl](...args));
    }
    return s;
  }
}

async function fetchWithOptions(url) {
  const cfg = {
    cache: cmdr.cache === true ? cfgStore.data.cachePath: cmdr.cache,
    expire: cmdr.expire
  };
  if (!isURL(url)) {
    if (!await fs.pathExists(url)) {
      return '';
    }
    return (await fs.readFile(url)).toString();
  }
  
  if (!cfg.cache) {
    return await axiosGetWithOptions(url);
  }

  const cachePath = isString(cfg.cache)
    ? path.join(cfg.cache, toFilePath(url))
    : path.join(os.tmpdir(), toFilePath(url));

  if (!await fs.pathExists(cachePath)) {
    const content = await axiosGetWithOptions(url);
    if (content) {
      await fs.ensureFile(cachePath);
      if (cmdr.save) {
        content.pipe(fs.createWriteStream(cachePath));
      } else {
        await fs.writeFile(cachePath, content);
      }
      return content;
    } else {
      return '';
    }
  }

  const now = new Date().getTime();
  const fileCreatedAt = (await fs.stat(cachePath)).mtime.getTime();
  
  if (now - fileCreatedAt > cfg.expire * 1000) {
    const content = await axiosGetWithOptions(url);
    if (content) {
      await fs.ensureFile(cachePath);
      if (cmdr.save) {
        content.pipe(fs.createWriteStream(cachePath));
      } else {
        await fs.writeFile(cachePath, content);
      }
    }
    return content;
  } else {
    if (cmdr.save) {
      return fs.createReadStream(cachePath);
    } else {
      return (await fs.readFile(cachePath)).toString();
    }
  }
}

async function axiosGetWithOptions(url) {
  log.debug('Get', url);
  try {
    const {data} = await axios.get(url, {
      timeout: Number(cmdr.timeout) || 30000,
      headers: {
        'User-Agent': userAgents[cmdr.userAgent || 'default']
      },
      responseType: cmdr.save ? 'stream' : undefined
    });
    if (cmdr.save) {
      return data; // This is a pipable stream.
    }
    return prettyHTMLOrNot(data);
  } catch (error) {
    log.error('Fetch error:', error.message, url);
    return null;
  }
}

function toFilePath(s, format='hierachy') {
  if (format === 'hierachy') {
    s = s.split('/').filter(s => !!s);
    s[0] = s[0].replace(':', '');
    if (s.length === 2) {
      s.push('index.html')
    }
    s = s.map(encodeURIComponent);
    s = path.join(...s);
    if (!s.match(/\.(htm|html|json|xhtml|xml|pdf|asp|aspx|php|png|gif|jpg|jpeg|svg|txt|zip|mov|avi|psd|rtf)$/)) {
      s = s + '.html';
    }
  } else if (format==='md5') {
    s = crypto.createHash('md5').update(s).digest('hex');
  }
  return s;
}

async function collectStream(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => {
      chunks.push(chunk);
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', (err) => {
      reject(err);
    });
  });
}


process.on('unhandledRejection', e => log.error('UnhandleRejection', e));