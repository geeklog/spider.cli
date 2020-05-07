#!/usr/bin/env node

/**
 * Spider for command line.
 * run `spider --help` for more infomation.
 */
const {spawn} = require('child_process');
const {green} = require('chalk');
const cmdr = require('commander');
const { expandURL, resolveMultipe } = require('./helper');
const Spider = require('./spider');
const SpiderDaemon = require('./spider.daemon');

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

const parseHeaders = desc => {
  if (!desc) {
    return {};
  }
  return desc.split('\\n').reduce((all, header) => {
    const [k, ...vs] = header.split(':');
    return Object.assign(all, {[k]: vs.join(':')});
  }, {});
}

cmdr.version('0.1.0');
cmdr.option('-c, --cache [cachePath]', 'use cache, if a cache path is specified, use that, other wise, use a path of (os tmp path + base64(url));')
cmdr.option('-e --expire [expireTime]', 'default expire time is 1day, if not specified', 86400)
cmdr.option('-u, --unique', 'unique')
cmdr.option('-r, --retry <times>', 'retry times')
cmdr.option('-p, --pretty', 'prettify html')
cmdr.option('-f, --follow <linkExtractor>', 'follow link')
cmdr.option('-t, --timeout <millsec>', 'set fetch timeout')
cmdr.option('-x, --headers <headers>', 'custom headers')
cmdr.option('--user-agent <userAgent>', 'user agent: chrome/firefox/safari')
cmdr.option('-v, --log [loglevel]', 'log messages levels: silent/debug/warn/error', 'silent')
cmdr.option('-D, --unescape', 'decode html entities')
cmdr.option('-T, --html', 'wrap output in html')
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
  .action(url => {
    expandURL(url).map(u => console.log(u))
  });
cmdr.command('res.headers [url]')
  .description('show the response headers')
  .action(url => {
    Spider.runForResponse(
      url,
      Object.assign(cmdr, {stream: true}),
      (res, output) => output(res.headers)
    )
  });
cmdr.command('get [url]').alias('g')
  .description('Get resource')
  .action(url => {
    Spider.runForResponse(url, cmdr, async (res, output) => output(await res.getData()))
  });
cmdr.command('save <path> [url]')
  .description('Save resource to path')
  .action((path, url) => {
    Spider.runForSpider(url, cmdr, async (u, spider) => {
      const filePath = spider.toSavePath(u, path);
      await spider.save(u, filePath);
    });
  });
cmdr.command('css <selector> [url]').alias('ext')
  .description('Apply css selector to extract content from html')
  .action(async (selector, url) => {
    Spider.runForResponse(url, cmdr, async (res, output) => {
      const ss = await res.css(selector).getall();
      ss.map(output);
    });
  });
cmdr.command('regex <re> [url]').alias('re')
  .description('Match RegExp from webpage')
  .action(async (re, url) => {
    Spider.runForResponse(url, cmdr, async (res, output) => {
      (await res.regex(re).getall()).map(output);
    });
  });
cmdr.command('link [url]').alias('l')
  .description('Extract links from webpage')
  .action(async url => {
    Spider.runForResponse(url, cmdr, async (res, output) => {
      for (const link of await res.links().getall()) {
        output(link);
      }
    });
  });
cmdr.command('image <url> [extractLevel]').alias('img')
  .description('Extract images from webpage')
  .action(async (url, extractLevel) => {
    Spider.runForResponse(url, cmdr, async (res, output) => {
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
cmdr.command('daemon <start/stop/status/screenshot/css/> [arg1] [arg2]')
  .description([
    'use headless browser',
    '  start <showBrowser> - start the headless browser daemon',
    '  stop - stop the headless browser daemon',
    '  screenshot <savePath> <url> - take screenshot',
    '  status - show status of browser',
    '  css <pattern> <url> - extract data using css selector',
    '    - ' + green("spider daemon css '.preview-card=>%html' https://www.30secondsofcode.org/js/p/1/"),
  ].join('\n'))
  .action(async (op, arg1, arg2) => {
    if (op === 'start') {
      const showBrowser = !!arg1;
      await SpiderDaemon.start({asDaemon: true, headless: !showBrowser});
      return;
    }
    if (op === 'stop') {
      await SpiderDaemon.call('shutdown');
      return;
    }
    if (op === 'status') {
      const stat = await SpiderDaemon.call('status');
      console.log(stat);
      return;
    }
    if (op === 'screenshot') {
      const savePath = arg1;
      const url = arg2;
      await SpiderDaemon.call('screenshot', {url, savePath});
      return;
    }
    if (op === 'css') {
      const pattern = arg1;
      const startURL = arg2;
      resolveMultipe(startURL, cmdr, async (url, output) => {
        (await SpiderDaemon.call('css', {pattern, url}))
          .map(r => output(r));
      });
      return;
    }
    throw new Error('Invalid operation: ' + op);
  });
cmdr.parse(process.argv);
cmdr.headers = parseHeaders(cmdr.headers);
