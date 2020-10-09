#!/usr/bin/env node

/**
 * Spider for command line.
 * run `spider --help` for more infomation.
 */
const {spawn} = require('child_process');
const {green} = require('chalk');
const cmdr = require('commander');
const cli = require('./cli');
const { expandURL, resolveMultipe } = require('./helper');
const Spider = require('./spider');
const SpiderDaemon = require('./spider.daemon');

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
cmdr.option('-d, --parts <n>', 'multipart download')
cmdr.option('-f, --follow <linkExtractor>', 'follow link')
cmdr.option('-t, --timeout <millsec>', 'set fetch timeout')
cmdr.option('-x, --headers <headers>', 'custom headers')
cmdr.option('-w, --wait-for <selector>', 'wait for selector')
cmdr.option('--user-agent <userAgent>', 'user agent: chrome/firefox/safari')
cmdr.option('-v, --log [loglevel]', 'log messages levels: silent/debug/warn/error', 'debug')
cmdr.option('-D, --unescape', 'decode html entities')
cmdr.option('-n, --parallel <n>', 'jobs run sequentially at default, use this options to fetch urls parallely at most <n> jobs', 1)
cmdr.option('--normalize-links', 'Normalize links')
cmdr.option('--remove-scripts', 'Remove scripts')
cmdr.option('--remove-empty-lines', 'Remove empty lines')
cmdr.option('--format-html', 'Format HTML')
cmdr.option('-p, --pretty', 'Prettify html, equals to: --normalize-links --remove-scripts --remove-empty-lines --format-html')
cmdr.command('config <getset> <key> [value]')
  .description('get or set configuration, the default configuration is store at ~/.spider.cli.json')
  .action((getset, key, value) => {
    const args = cli.cmdrOptions(cmdr);
    if (getset === 'get') {
      const r = new Spider(args).cfg.get(key);
      console.log(r);
    } else if (getset === 'set') {
      new Spider(args).cfg.set(key, value);
    } else if (getset === 'toggle') {
      new Spider(args).cfg.toggle(key, value.toLowerCase() === 'true' || value === '1');
    } else {
      console.error(`Invalid operation: ${getset}`);
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
      Object.assign(cli.cmdrOptions(cmdr), {stream: true}),
      (res, output) => output(res.headers)
    )
  });
cmdr.command('get [url]').alias('g')
  .description('Get resource')
  .action(url => {
    Spider.runForResponse(url, cli.cmdrOptions(cmdr), async (res, output) => output(await res.getData()))
  });
cmdr.command('save <path> [url]')
  .description('Save resource to path')
  .action((path, url) => {
    Spider.runForSpider(url, cli.cmdrOptions(cmdr), async (u, spider) => {
      const filePath = spider.toSavePath(u, path);
      let load;
      await spider.save(u, filePath, Object.assign(cli.cmdrOptions(cmdr), {
        onStart(totals) {
          if (cmdr.log === 'progress') {
            load = cmdr.parts
              ? cli.multiProgressing(totals, '[=-]', 50)
              : cli.progressing(totals, '[=-]', 50);
          }
        },
        onProgress(curr, incr, i) {
          if (cmdr.log === 'progress') {
            cmdr.parts
              ? load.progress(i, incr)
              : load.progress(curr);
          }
        }
      }));
    });
  });
cmdr.command('css <selector> [url]').alias('ext')
  .description('Apply css selector to extract content from html')
  .action(async (selector, url) => {
    Spider.runForResponse(url, cli.cmdrOptions(cmdr), async (res, output) => {
      const ss = await res.css(selector).getall();
      ss.map(output);
    });
  });
cmdr.command('regex <re> [url]').alias('re')
  .description('Match RegExp from webpage')
  .action(async (re, url) => {
    Spider.runForResponse(url, cli.cmdrOptions(cmdr), async (res, output) => {
      (await res.regex(re).getall()).map(output);
    });
  });
cmdr.command('link [url]').alias('l')
  .description('Extract links from webpage')
  .action(async url => {
    Spider.runForResponse(url, cli.cmdrOptions(cmdr), async (res, output) => {
      for (const link of await res.links().getall()) {
        output(link);
      }
    });
  });
cmdr.command('image <url> [extractLevel]').alias('img')
  .description('Extract images from webpage')
  .action(async (url, extractLevel) => {
    Spider.runForResponse(url, cli.cmdrOptions(cmdr), async (res, output) => {
      (await res.images(extractLevel).getall()).map(output);
    });
  });
cmdr.command('article <url> [options]').alias('arc')
  .description('Extract main article from webpge')
  .action(async (url, options) => {
    Spider.runForResponse(url, cli.cmdrOptions(cmdr), async (res, output) => {
      const html = await res.getData();
      const extractor = require('unfluff');
      const data = extractor(html);
      console.log(data.text);
    });
  });
cmdr.command('shell <url>')
  .description('interactive shell')
  .action(async (url) => {
    const options = JSON.stringify(cli.cmdrOptions(cmdr));
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
      await SpiderDaemon.call('screenshot', {url, savePath, waitFor: cmdr.waitFor});
      return;
    }
    if (op === 'css') {
      const pattern = arg1;
      const startURL = arg2;
      resolveMultipe(startURL, cli.cmdrOptions(cmdr), async (url, output) => {
        (await SpiderDaemon.call('css', {pattern, url}))
          .map(r => output(r));
      });
      return;
    }
    throw new Error('Invalid operation: ' + op);
  });
cmdr.parse(process.argv);
cmdr.headers = parseHeaders(cmdr.headers);
