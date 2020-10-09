import qrpc from 'qrpc';
import { resolveURLs, uniqOutput, concurrently } from './helper';

export const start = async ({asDaemon, headless}) => {
  if (asDaemon) {
    require('daemon')({cwd: process.cwd()});
  }
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({headless});
  const server = qrpc.createServer();

  server.addHandler('css', async (req, res, next) => {
    const {pattern, url} = req.m;
    const page = await browser.newPage();
    await page.goto(url);
    const [selector, format] = pattern.split('=>');
    await page.waitFor(selector);
    const results = await page.evaluate((selector, format) => {
      const rs = [];
      // eslint-disable-next-line no-undef
      document.querySelectorAll(selector).forEach(item => {
        if (!format || format === '%html') {
          rs.push(item.outerHTML);
        } else if (format === '%text') {
          rs.push(item.innerText);
        } else if (format .startsWith('@')) {
          const attr = format.substring(1);
          rs.push(item.getAttribute(attr));
        } else {
          return rs.toString();
        }
      });
      return rs;
    }, selector, format);
    await page.close();
    next(null, results);
  });
  server.addHandler('status', async (req, res, next) => {
    next(null, 'running');
  });
  server.addHandler('screenshot', async (req, res, next) => {
    try {
      const {url, savePath, waitFor} = req.m;
      const page = await browser.newPage();
      await page.goto(url);
      if (waitFor) {
        await page.waitForSelector(waitFor);
      }
      await page.screenshot({path: savePath});
      await page.close();
      next(null, 'ok');
    } catch (error) {
      next(error);
    }
  });
  server.addHandler('shutdown', async (req, res, next) => {
    await browser.close();
    next(null, 'ok');
    await server.close();
  })
  server.listen(1337, () => {
    console.log('server listening on port 1337');
  });
}

export const call = async (cmd, args = {}): Promise<any> => {
  return new Promise((resolve, reject) => {
    const client = qrpc.connect(1337, 'localhost', () => {
      client.call(cmd, args, function(err, ret) {
        client.close();
        err ? reject(err) : resolve(ret);
      });
    });
  });
}

export const runForCSS = async (startUrls, pattern, options, _yield) => {
  const urls = await resolveURLs(startUrls);
  const output = uniqOutput(options.unique);
  let q;
  const fn = async u => {
    if (!u) {
      return;
    }
    const res = await call('css', pattern);
    await _yield(res, output);
    if (options.follow) {
      const followURL = await res.css(options.follow).get();
      q.go(fn.bind(null, res.normalizeLink(followURL)));
    }
  }
  q = concurrently(options.parallel, urls, fn);
}

/**
 * node spider.daemon.js -D -H
 */
if (!module.parent) {
  start({
    asDaemon: process.argv.indexOf('-D') >= 0,
    headless: process.argv.indexOf('H') >= 0
  });
}