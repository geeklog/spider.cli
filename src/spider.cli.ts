#!/usr/bin/env node

/**
 * Spider for command line.
 * run `spider --help` for more infomation.
 */
import { spawn } from 'child_process';
import chalk from 'chalk';
import cmdr from 'commander';
import * as cli from './cli';
import { expandURL, parseHeaders, uniqOutput } from './helper';
import Spider from './spider';
import { SpiderResponse } from './response';
import * as SpiderDaemon from './spider.daemon';
import { concurrent } from 'conflow';
import { forEachIter } from './types';

const batchRunForResponse = async(
  url: string, 
  {stream}: { stream?: boolean},
  handler: (
    url: string,
    res: SpiderResponse,
    output: (s: any) => void
  ) => Promise<void>
) => {
  const urlsIter = expandURL(url);
  const options = Object.assign({}, cli.cmdrOptions(cmdr.program), {stream});
  const output = uniqOutput(options.unique);
  const spider = new Spider({...options});
  const jobs = concurrent(options.parallel, {preserveOrder: true});
  const fetch = async (url: string) => {
    const res = await spider.get(url);
    await handler(url, res, output);
    if (options.follow) {
      const followURL = res.normalizeLink(await res.css(options.follow).get());
      followURL && jobs.go(() => fetch(url));
    }
  };
  await jobs.forEach(urlsIter, async (url: string) => {
    await fetch(url);
  });
}

const batchRunForSpider = async(
  url: string, 
  {stream}: { stream?: boolean},
  handler: (
    url: string,
    spider: Spider,
    output: (s: any) => void
  ) => Promise<void>
) => {
  const urlsIter = expandURL(url);
  const options = Object.assign({}, cli.cmdrOptions(cmdr.program), {stream});
  const output = uniqOutput(options.unique);
  const spider = new Spider({...options});
  const jobs = concurrent(options.parallel, {preserveOrder: true});
  jobs.forEach(urlsIter, async (url: string) => {
    await handler(url, spider, output);
  });
}

cmdr.version('0.1.0');
cmdr.option('-c, --cache [cachePath]',
            'use cache, if a cache path is specified, use that, other wise, use a path of (os tmp path + base64(url));')
cmdr.option('-e, --expire [expireTime]',
            'default expire time is 1day, if not specified', (value, prev) => value || prev, 86400000)
cmdr.option('-i, --unique', 'unique')
cmdr.option('-r, --retry <times>', 'retry times')
cmdr.option('-d, --parts <n>',
            'Speed up the download by split the payload to <n> parts and download them concurrently')
cmdr.option('-f, --follow <linkExtractor>', 'follow link')
cmdr.option('-t, --timeout <millsec>', 'set fetch timeout')
cmdr.option('-x, --headers <headers>', 'custom headers')
cmdr.option('-u, --user-agent <userAgent>', 'user agent: chrome/firefox/safari')
cmdr.option('-v, --log [loglevel]',
            'log messages levels: silent/debug/warn/error',
            (value, prev) => value || prev,
            'silent')
cmdr.option('--wait-for', 'wait for document ready (in headless browser)')
cmdr.option('-D, --unescape', 'decode html entities')
cmdr.option('-n, --parallel <n>',
            'jobs run sequentially at default, use this options to fetch urls parallely at most <n> jobs',
            (value, prev) => value || prev
            ,
            1)
cmdr.option('-L, --normalize-links',
            'Normalize links, make the links start with http://www.domain etc')
cmdr.option('--remove-scripts', 'Remove scripts from the html')
cmdr.option('--remove-empty-lines', 'Remove empty lines from the html')
cmdr.option('--format-html', 'Format and prettify HTML')
cmdr.option('-p, --pretty',
            'Prettify html, equals to: --normalize-links --remove-scripts --remove-empty-lines --format-html')

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
  .description('Expands url pattern [1..100] | [1..2..100] | [1..] | [1..2..]')
  .action(async url => {
    const urlsIter = expandURL(url);
    await forEachIter(urlsIter, (url) => console.log(url));
  });
cmdr.command('res.headers [url]')
  .description('show the response headers')
  .action(urlPattern => {
    batchRunForResponse(urlPattern, {stream: true}, async (url, res, output) => output(res.headers));
  });
cmdr.command('get [url]').alias('g')
  .description('Get resource')
  .action(urlPattern => {
    batchRunForResponse(urlPattern, {}, async (url, res, output) => output(await res.getData()))
  });
cmdr.command('save <path> [url]')
  .description('Save resource to path')
  .action((path, urlPattern) => {
    batchRunForSpider(urlPattern, {}, async (url, spider, output) => {
      const filePath = spider.toSavePath(url, path);
      let load;
      await spider.save(url, filePath, {
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
      });
    });
  });
cmdr.command('css <selector> [url]').alias('ext')
  .description('Apply css selector to extract content from html')
  .action(async (selector, urlPattern) => {
    batchRunForResponse(urlPattern, cmdr.options, async (url, res, output) => {
      const ss = await res.css(selector).getall();
      ss.map(output);
    });
  });
cmdr.command('regex <re> [url]').alias('re')
  .description('Match RegExp from webpage')
  .action(async (re, urlPattern) => {
    batchRunForResponse(urlPattern, cmdr.options, async (url, res, output) => {
      (await res.regex(re).getall()).map(output);
    });
  });
cmdr.command('link [url]').alias('l')
  .description('Extract links from webpage')
  .action(async urlPattern => {
    batchRunForResponse(urlPattern, cmdr.options, async (url, res, output) => {
      for (const link of await res.links().getall()) {
        output(link);
      }
    });
  });
cmdr.command('image <url> [extractLevel]').alias('img')
  .description('Extract images from webpage')
  .action(async (urlPattern, extractLevel) => {
    batchRunForResponse(urlPattern, {}, async (url, res, output) => {
      (await res.images(extractLevel).getall()).map(output);
    });
  });
cmdr.command('article <url> [options]').alias('arc')
  .description('Extract main article from webpge')
  .action(async (urlPattern, options) => {
    batchRunForResponse(urlPattern, {}, async (url, res, output) => {
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
    '    - ' + chalk.green("spider daemon css '.preview-card=>%html' https://www.30secondsofcode.org/js/p/1/"),
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
      const options = Object.assign({}, cli.cmdrOptions(cmdr.program));
      const urlsIter = expandURL(startURL);
      const output = uniqOutput(options.unique);
      const q = concurrent(options.parallel, {preserveOrder: true});
      forEachIter(urlsIter, (url: string) => {
        q.go(async () => {
          (await SpiderDaemon.call('css', {pattern, url}))
            .map(r => output(r));
        });
      });
      return;
    }
    throw new Error('Invalid operation: ' + op);
  });
cmdr.parse(process.argv);
cmdr.headers = parseHeaders(cmdr.headers);
cmdr.options = cli.cmdrOptions(cmdr);
