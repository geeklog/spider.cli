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
cmdr.option('-a, --asc', 'sort asc');
cmdr.option('-d, --dasc', 'sort dasc');
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

cmdr.command('links <url>').alias('l')
  .description('Extract links from webpage')
  .action(async url => {
    const urls = expandUrlList(url);

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

async function fetchWithOptions(url) {
  return await fetch(url, {cache: cmdr.cache, expire: cmdr.expire});
}

async function fetch(url, cfg) {
  const isURL = s => s.startsWith('http:') || s.startsWith('https:') || s.startsWith('ftp:');
  const base64 = s => Buffer.from(s).toString('base64');

  if (!isURL(url)) {
    return fs.readFileSync(url).toString();
  }
  
  if (!cfg.cache) {
    return (await axios.get(url)).data;
  }

  const cachePath = isString(cfg.cache)
    ? path.join(cfg.cache, base64(url))
    : path.join(os.tmpdir(), base64(url));

  if (!fs.existsSync(cachePath)) {
    const content = (await axios.get(url)).data;
    fs.writeFileSync(cachePath, content);
  }

  const now = new Date().getTime();
  const fileCreatedAt = fs.statSync(cachePath).mtime.getTime();
  
  if (now - fileCreatedAt > cfg.expire * 1000) {
    const content = (await axios.get(url)).data;
    fs.writeFileSync(cachePath, content);
    return content;
  } else {
    return fs.readFileSync(cachePath).toString();
  }

}

process.on('unhandledRejection', e => console.error(e))