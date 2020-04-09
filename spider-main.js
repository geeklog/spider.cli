#!/usr/bin/env node

/**
 * Spider tools for cli.
 * run `spider --help` for more infomation.
 */

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

const dir = s => path.join(__dirname, s);

const REGEX_HTTP_URL = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
const REGEX_ANY_URL = /[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
const REGEX_IMG_TAG = /<img.*?src="(.*?)"[^>]+>/g;

cmdr.version('0.1.0');
cmdr.option('-c, --cache [cachePath]',
  'use cache, if a cache path is specified, use that, ' +
  'other wise, use a path of (os tmp path + base64(url)); '
);
cmdr.option('-e --expire [expireTime]', 'default expire time is 1day, if not specified', 86400);
cmdr.option('-u, --unique', 'unique');
cmdr.option('-t, --timeout <millsec>', 'set fetch timeout');
cmdr.option('-a, --asc', 'sort asc');
cmdr.option('-d, --dasc', 'sort dasc');
cmdr.option('-v, --verbose', 'show verbose get message');
cmdr.option('-w, --warn', 'ignore fetch error, just show as warning');
cmdr.option('-D, --decode-entities', 'decode html entities');
cmdr.option('-H, --html', 'output as html');
cmdr.option('-p, --parallel <n>',
  'jobs run sequentially at default, use this ' +
  'options to fetch urls parallely at most <n> jobs'
);

cmdr.command('expands <url>').alias('e')
  .description('Expands url pattern [1..100]')
  .action(async url => {
    expandUrlList(url).map(u => console.log(u));
  });

cmdr.command('links [url]').alias('l')
  .description('Extract links from webpage')
  .action(async url => {
    let urls;
    if (!url) {
      urls = flatten((await stdin()).split('\n').map(expandUrlList));
    } else {
      urls = expandUrlList(url);
    }

    let links = await runsWithOptions(urls, {flatten: true},
      async (url) => {
        const html = await fetchWithOptions(url);
        return html.match(REGEX_HTTP_URL);
      }
    );

    links = convertListWithOptions(links);

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

    let imgs = runsWithOptions(urls, {flatten: true}, async url => {
      const html = await fetchWithOptions(url);
      return html.match(REGEX_IMG_TAG);
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
  })

cmdr.command('extract <url> <pattern>').alias('ext')
  .description('Extract html page base on the selector pattern')
  .action(async (url, pattern) => {
    const urls = expandUrlList(url);
    const htmls = await runsWithOptions(urls, {flatten: true}, fetchWithOptions);
    for (let html of htmls) {
      const results = parseHtmlWithOption(html, pattern);
      for (const r of results) {
        console.log(r);
      }
    }
  });

cmdr.parse(process.argv);


/*****************************************
 * Common utils
 *****************************************/ 

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
  for (let i=Number(left); i<Number(right); i++) {
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

/**
 * spider extract https://www.cnbeta.com/ '.items-area .item dl > dt > a => <text/> | @href' -cE
 * spider extract https://www.cnbeta.com/ '.items-area .item dl > dt > a'
 *   the same as <html/>
 * @param {*} html 
 * @param {*} pattern 
 */
function parseHtmlWithOption(html, pattern) {
  const unescapeOrNot = s => cmdr.unescape ? entities.decode(s) : s;
  let [selector, formatter] = pattern.split('=>').map(s => s.trim());
  const $ = cheerio.load(html);
  const results = [];
  if (!formatter) {
    formatter = '<html/>';
  }
  for (const el of $(selector).toArray().map($)) {
    const res = format(formatter, {
      '@(.+)': (_, s) => unescapeOrNot(el.attr(s)),
      '<html/>': () => unescapeOrNot($.html(el)),
      '<text/>': () => unescapeOrNot(el.text())
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
  return await fetch(url, {cache: cmdr.cache, expire: cmdr.expire});
}

async function fetch(url, cfg) {
  const isURL = s => s.startsWith('http:') || s.startsWith('https:') || s.startsWith('ftp:');

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
    ? path.join(cfg.cache, shortenURL(url))
    : path.join(os.tmpdir(), shortenURL(url));

  if (!await fs.pathExists(cachePath)) {
    const content = await axiosGetWithOptions(url);
    if (content) {
      await fs.ensureFile(cachePath);
      await fs.writeFile(cachePath, content);
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
      await fs.writeFile(cachePath, content);
    }
    return content;
  } else {
    return (await fs.readFile(cachePath)).toString();
  }
}

async function axiosGetWithOptions(url) {
  if (cmdr.verbose) {
    console.log('Get', url);
  }
  if (cmdr.warn) {
    try {
      return (await axios.get(url, { timeout: Number(cmdr.timeout) || 30000 })).data;
    } catch (error) {
      console.error('Fetch error:', error.message, url);
      return null;
    }
  } else {
    return (await axios.get(url)).data;
  }
}

function shortenURL(s) {
  s = crypto.createHash('md5').update(s).digest('hex');
  return s;
}

process.on('unhandledRejection', e => console.error(e))