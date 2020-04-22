#!/usr/bin/env node

/**
 * Spider tools for cli.
 * run `spider --help` for more infomation.
 * 
 * * spider extract '.items-area .item dl > dt > a => %text : @href' https://www.cnbeta.com/
 * * spider extract '.items-area .item dl > dt > a' https://www.cnbeta.com/ 
 *    default is %html
 */
const {spawn} = require('child_process');
const concurrent = require('concurr').default;
const {flatten} = require('lodash');
const path = require('path');
const Spider = require(path.join(__dirname, './spider'));
const stdin = require(path.join(__dirname, './stdin'));
const cmdr = require('commander');

const getOptions = o => {
  const options = {};
  const skips = ['commands', 'options', 'Command', 'Option', 'rawArgs', 'args'];
  for (const k of Object.keys(o)) {
    if (skips.indexOf(k) >= 0 || k.startsWith('_')) {
      continue;
    }
    options[k] = o[k];
  }
  return options;
}

const resolveURLs = async (url, expand) => {
  if (url) {
    return expand(url);
  } else {
    const urls = flatten((await stdin()).split('\n').map(s => expand(s)));
    return urls;
  }
};

const concurrently = (n, vals, fn) => {
  const q = concurrent(n);
  for (const v of vals) {
    q.go(fn.bind(null, v));
  }
};

const uniqOutput = (b) => {
  const a = new Set();
  return (s) => {
    if (!b) {
      console.log(s);
      return;
    }
    if (a.has(s)) {
      return;
    }
    a.add(s);
    console.log(s);
  }
};

const runSpider = async (url, fn) => {
  const spider = new Spider(cmdr);
  const urls = await resolveURLs(url, spider.expand);
  const output = uniqOutput(cmdr.unique);
  concurrently(cmdr.parallel, urls, async u => await fn(u, spider, output));
};

cmdr.version('0.1.0');
cmdr.option('-c, --cache [cachePath]', 'use cache, if a cache path is specified, use that, other wise, use a path of (os tmp path + base64(url));')
cmdr.option('-e --expire [expireTime]', 'default expire time is 1day, if not specified', 86400)
cmdr.option('-u, --unique', 'unique')
cmdr.option('-r, --retry <times>', 'retry times')
cmdr.option('-p, --pretty', 'prettify html')
cmdr.option('-f, --follow <linkExtractor>', 'prettify html')
cmdr.option('-t, --timeout <millsec>', 'set fetch timeout')
cmdr.option('-v, --log [loglevel]', 'log messages levels:debug/warn/error', 'silent')
cmdr.option('-D, --decode-entities', 'decode html entities')
cmdr.option('-H, --html', 'output as html')
cmdr.option('-A, --user-agent', 'user agent: chrome/firefox/safari')
cmdr.option('-n, --parallel <n>', 'jobs run sequentially at default, use this options to fetch urls parallely at most <n> jobs', 1)
cmdr.command('config <getset> <key> [value]')
  .description('get or set configuration, the default configuration is store at ~/.spider.cli.json')
  .action((getset, key, value) => {
    if (getset === 'get') {
      console.log(new Spider(cmdr).getConfig(key));
    } else if (getset === 'set') {
      new Spider(cmdr).setConfig(key, value);
    } else {
      throw new Error('Invalid Arguments');
    }
  });
cmdr.command('expand <url>').alias('e')
  .description('Expands url pattern [1..100]')
  .action(async url =>
    new Spider(cmdr).expand(url).map(u => console.log(u))
  );
cmdr.command('res.headers [url]')
  .description('show the response headers')
  .action(async (url) => runSpider(url, async (u, spider, output) => {
    const res = await spider.get(u);
    output(res.headers);
  }));
cmdr.command('get [url]').alias('g')
  .description('Get resource')
  .action(async url => runSpider(url, async (u, spider, output) => {
    const res = await spider.get(u);
    output(await res.getData());
  }));
cmdr.command('save <path> [url]')
  .description('Save resource to path')
  .action(async (url, path) => runSpider(url, async (u, spider) => {
    const filePath = spider.toSavePath(u, path);
    await spider.save(url, filePath);
  }));
cmdr.command('css <selector> [url]').alias('ext')
  .description('Apply css selector to extract content from html')
  .action(async (selector, url) => {
    runSpider(url, async (u, spider, output) => {
      const res = await spider.get(u);
      (await res.css(selector).getall()).map(output);
    });
  });
cmdr.command('regex <re> [url]').alias('re')
  .description('Match RegExp from webpage')
  .action(async (re, url) => {
    runSpider(url, async (u, spider, output) => {
      const res = await spider.get(u);
      (await res.regex(re).getall()).map(output);
    });
  });
cmdr.command('link [url]').alias('l')
  .description('Extract links from webpage')
  .action(async url => {
    runSpider(url, async (u, spider, output) => {
      if (!u) {
        return;
      }
      const res = await spider.get(u);
      for (const link of await res.links().getall()) {
        output(link);
      }
    });
  });
cmdr.command('image <url> [extractLevel]').alias('img')
  .description('Extract images from webpage')
  .action(async (url, extractLevel) => {
    runSpider(url, async (u, spider, output) => {
      const res = await spider.get(u);
      (await res.images(extractLevel).getall()).map(output);
    });
  });
cmdr.command('shell <url>')
  .description('interactive shell')
  .action(async (url) => {
    const options = JSON.stringify(getOptions(cmdr));
    spawn(
      `node --experimental-repl-await -e '(new (require("${__dirname}/spider"))(${options})).shell("${url}")'`,
      {stdio: 'inherit', shell: true}
    );
  });
cmdr.parse(process.argv);
