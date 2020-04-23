const qrpc = require('qrpc');

exports.start = async ({asDaemon, headless}) => {
  if (asDaemon) {
    require('daemon')({cwd: process.cwd()});
  }
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({headless});
  const server = qrpc.createServer();

  server.addHandler('css', async (req, res, next) => {
    const {pattern, url} = req.m;
    console.log('pattern', pattern);
    console.log('url', url);
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
  server.addHandler('screenshot', async (req, res, next) => {
    try {
      const {url, savePath} = req.m;
      const page = await browser.newPage();
      await page.goto(url);
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

exports.call = async (cmd, args) => {
  return new Promise((resolve, reject) => {
    const client = qrpc.connect(1337, 'localhost', () => {
      client.call(cmd, args || {}, function(err, ret) {
        client.close();
        err ? reject(err) : resolve(ret);
      });
    });
  });
}

if (!module.parent) {
  exports.start({
    asDaemon: process.argv.indexOf('-D') >= 0,
    headless: process.argv.indexOf('H') >= 0
  });
}