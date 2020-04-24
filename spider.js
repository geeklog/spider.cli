const util = require('util');
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
const os = require('os');
const stream = require('stream');
const {uniq, flatten, isArray, isString, isJSON, isFunction} = require('lodash');
const isStream = require('is-stream');
const pretty = require('pretty');
const cheerio = require('cheerio');
const crypto = require('crypto');
const entities = new (require('html-entities').XmlEntities)();
const JQ = require('node-jq');
const {collectStream} = require('./stream');
const {isURL, resolveURLs, uniqOutput, concurrently} = require('./helper');

const userAgents = {
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36',
  googlebot: 'Googlebot/2.1 (+http://www.googlebot.com/bot.html)',
  default: 'CURL'
};
class Logger {
  constructor(level = 'none') {
    this.level = level;
  }
  debug(...args) {
    if (this.level === 'debug') {
      console.log(...args);
    }
  }
  warn(...args) {
    if (this.level === 'debug' || this.level === 'warn') {
      console.log(...args);
    }
  }
  error(...args) {
    if (this.level === 'debug' || this.level === 'warn' || this.level === 'error') {
      console.log(...args);
    }
  }
}

class ConfigLoader {
  constructor(path) {
    this.path = path = path.replace('~', os.homedir());
    this.data = null;
  }
  load() {
    fs.ensureFileSync(this.path);
    const jsonStr = fs.readFileSync(this.path).toString();
    if (jsonStr) {
      this.data = JSON.parse(jsonStr);
    }
  }
  save () {
    fs.writeFileSync(path, JSON.stringify(this.data, null, 2));
  }
}

class CssSelector {
  constructor(content, options) {
    this.content = content;
    this.options = options;
    this.unescapeOrNot = s => this.options.unescape ? entities.decode(s) : s;
    this.prettyJSONOrNot = s => this.options.pretty ? JSON.stringify(JSON.parse(s), null, 2) : s;
    this.prettyHTMLOrNot = s => this.options.pretty ? pretty(s) : s;
  }
  css(pattern) {
    let [selector, formatter] = pattern.split('=>').map(s => s.trim());
    const data = this.content;
    if (!data) {
      return null;
    }
    const $ = cheerio.load(data);
    const results = [];
    if (!formatter) {
      formatter = '%html';
    }
    for (const el of $(selector).toArray().map($)) {
      const res = format(formatter, {
        '@([a-z|A-Z|0-9|-|_]+)': (_, s) => this.unescapeOrNot(el.attr(s)) || '',
        '%html': () => this.unescapeOrNot(this.prettyHTMLOrNot($.html(el))),
        '%text': () => this.unescapeOrNot(el.text()),
        '%element': () => util.format(el[0]),
        '%json': () => el[0].children.map(_ => this.prettyJSONOrNot(_.data)).join('\n')
      });
      results.push(res);
    }
    
    return {
      get: () => results[0],
      getall: () => results
    };

    function format(s, replacements) {
      for (const repl in replacements) {
        s = s.replace(new RegExp(repl, 'g'), (...args) => replacements[repl](...args));
      }
      return s;
    }
  }
}

class Response {

  constructor({url, data, res, options}) {
    this.url = url;
    this.res = res;
    this.data = data || (res ? res.data : null);
    this.headers = res ? res.headers: null;
    this.options = options;
  }

  fixLink(link) {
    if (link.startsWith('http:') || link.startsWith('https:')) {
      return link;
    }
    if (link.startsWith('//')) {
      return 'https:' + link;
    }
    const domain = this.url.split('/').slice(0, 3).join('/');
    return domain + '/' + link;
  }

  async getData() {
    if (!this.data && !this.res) {
      return null;
    }
    let data = this.data || this.res.data;
    if (isStream(data)) {
      data = await collectStream(data);
    }
    if (this.options.prettyHTML) {
      data = pretty(data);
    }
    return data;
  }

  async jq(pattern) {
    const data = await this.getData();
    try {
      return JSON.parse(await JQ.run(pattern, data, { input: 'json' }));
    } catch(err) {
      console.error(err, data);
    }
  }

  css(pattern) {
    const p = this.getData().then(
      data => new CssSelector(data, this.options).css(pattern).getall()
    );
    p.get = () => p.then((results) => results[0]);
    p.getall = () => p.then((results) => results);
    p.map = fn => p.then((results) => {
      return (results || []).map(r => fn(new CssSelector(r, this.options)));
    });
    p.each = fn => p.then((results) => {
      (results || []).forEach(r => fn(new CssSelector(r, this.options)));
    });
    return p;
  }

  regex(re, group=0) {
    const p = this.getData().then(data => {
      if (!data) {
        return null;
      }
      let matches, output = [];
      // eslint-disable-next-line no-cond-assign
      while (matches = re.exec(data)) {
        output.push(matches[group]);
      }
      return output;
    });
    p.get = () => p.then((results) => results ? results[0] : null);
    p.getall = () => p.then((results) => results ? results : []);
    return p;
  }

  links() {
    const p = this.css('a => @href').then(links => {
      if (!links) {
        return [];
      }
      return links.map(l => this.fixLink(l));
    });
    p.get = () => p.then(_ => _[0]);
    p.getall = () => p.then(_ => _);
    return p;
  }

  images(group=0) {
    if (group != 0 && group != 1) {
      throw new Error('Invalid group: ' + group);
    }
    const p = this.css('img => ' + ['%html','@src'][group]).then(imgs => {
      if (!imgs) {
        return [];
      }
      if (group == 1) {
        return imgs.map(_ => this.fixLink(_)).filter(_ => !!_);
      }
    });
    p.get = () => p.then(_ => _[0]);
    p.getall = () => p.then(_ => _);
    return p;
  }

  pipe(stream) {
    if (!this.data && !this.res) {
      throw new Error('Fetch Fail:' + this.url);
    }
    const data = this.data || this.res.data;
    if (!isStream(data)) {
      throw new Error('Data is not a stream, can\'t be piped!');
    }
    data.pipe(stream);
  }
}

module.exports = class Spider {

  static async runForResponse(startUrls, options, _yield) {
    const spider = new Spider(options);
    const urls = await resolveURLs(startUrls, Spider.expand);
    const output = uniqOutput(options.unique);
    let q;
    const fn = async u => {
      if (!u) {
        return;
      }
      const res = await spider.get(u);
      await _yield(res, output);
      if (options.follow) {
        const followURL = await res.css(options.follow).get();
        q.go(fn.bind(null, res.fixLink(followURL)));
      }
    }
    q = concurrently(options.parallel, urls, fn);
  }

  static async runForSpider(startUrls, options, _yield) {
    const spider = new Spider(options);
    const urls = await resolveURLs(startUrls, Spider.expand);
    const output = uniqOutput(options.unique);
    const fn = async u => {
      await _yield(u, spider, output);
    }
    concurrently(options.parallel, urls, fn);
  }

  constructor(options = {}) {
    this.options = options;
    this.cfg = new ConfigLoader('~/.spider.cli.json');
    this.logger = new Logger(options.log);

    this.cfg.load();

    if (this.options.cache === true) {
      this.options.cache = this.cfg.data.cachePath
    }
  }

  getConfig(key) {
    if (key === '*') {
      return this.cfg.data;
    }
    return this.cfg.data[key];
  }

  setConfig(key, value) {
    this.cfg.data[key] = value;
    this.cfg.save();
  }

  async shell(url) {
    const res = await this.get(url);
    const repl = require('repl');
    const context = repl.start('> ').context;
    context.spider = this;
    context.res = res;
    context.$ = cheerio.load(res.data);
  }

  async save(url, filePath, options) {
    if (!url) {
      throw new Error('Malform URL:'+url);
    }
    // this.logger.debug('Saving:', url, filePath);
    options = Object.assign({}, {stream: true, cache: false}, options);
    // TODO
    // 检查文件是否存在
    // 如果是, 检查文件是部分下载还是全部下载,
    // 如果部分下载, 断点续传 (如果服务端支持的话)
    // 如果已经下载, 跳过, 不需要重新下载
    // if (await fs.exists(filePath) && (await fs.stat(filePath)).size >= 0) {
    //   return true;
    // }
    let res = await this.get(url, options);
    
    await fs.ensureFile(filePath);
    res.pipe(fs.createWriteStream(filePath));
    
    try {
      // Waiting for transmition complete, because the scheduler need this
      // to do the rate limiting right.
      await new Promise((resolve, reject) => {
        const w = new stream.Writable();
        w._write = (chunk, encoding, done) => done();
        w.end = resolve;
        w.on('error', reject);
        res.pipe(w);
      });
    } catch(err) {
      this.logger.error('Save Fail:', err.message, url, filePath);
      if (options.retry > 0) {
        this.logger.error('Retry:', url, filePath);
        options.try = options.try || 0;
        options.try ++;
        options.retry --;
        this.save(url, filePath, options);
      }
    }
    // this.logger.debug('Save Complete:', url, filePath);
  }

  async getBatch(url, check, _yield) {
    const range = url.match(/\[(\d+?)\.\.]/);
    if (!range) {
      throw new Error('Wrong pattern: ' + url);
    }
    let [all, i] = range;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await this.get(url.replace(all, i));
      if (!await check(res)) {
        break;
      }
      await _yield(res);
      i++;
    }
  }
  
  async get(url, options = {}) {
    options = Object.assign({}, this.options, options);
    let {
      cache: useCache,
      stream: streamMode,
      expire: cacheExpire
    } = options;

    cacheExpire = cacheExpire || 0;

    if (!isURL(url)) {
      if (!await fs.pathExists(url)) {
        return new Response({url, data: null, options});
      }
      return new Response({
        url,
        data: (await fs.readFile(url)).toString(),
        options
      });
    }

    if (!useCache) {
      return new Response({
        url,
        res: await this.axiosGetWithOptions(url, options),
        options
      });
    }
  
    const cachePath = isString(useCache)
      ? path.join(useCache, this.toFilePath(url))
      : path.join(os.tmpdir(), this.toFilePath(url));
    
    let cacheExist = await fs.pathExists(cachePath);
    
    if (cacheExist) {
      const now = new Date().getTime();
      const stat = await fs.stat(cachePath)
      const fileCreatedAt = stat.mtime.getTime();
      if (now - fileCreatedAt > cacheExpire * 1000) {
        cacheExist = false;
      }
      if (stat.size <= 0) {
        cacheExist = false;
      }
    }

    if (cacheExist) {
      this.logger.debug('Cached:', cachePath);
    }
    
    if (streamMode && !cacheExist) {
      const res = await this.axiosGetWithOptions(url, options);
      if (!res) {
        return new Response({ url, res: null, options });
      }

      await fs.ensureFile(cachePath);
      res.data.pipe(fs.createWriteStream(cachePath));

      return new Response({ url, res, options });
    }

    if (streamMode && cacheExist) {
      const stream = fs.createReadStream(cachePath);
      return new Response({ url, data: stream, options});
    }

    if (!streamMode && !cacheExist) {
      const res = await this.axiosGetWithOptions(url, options);
      if (!res) {
        return new Response({ url, res, options });
      }
      await fs.ensureFile(cachePath);
      await fs.writeFile(
        cachePath,
        isString(res.data)
          ? res.data
          : JSON.stringify(res.data)
      );
      return new Response({ url, res, options});
    }

    if (!streamMode && cacheExist) {
      const data = (await fs.readFile(cachePath)).toString();
      return new Response({ url, data, options});
    }
    
  }

  async axiosGetWithOptions(url, options) {
    this.logger.debug('Get', url);
    const headers = Object.assign(
      {},
      { 'User-Agent': userAgents[options.userAgent || 'default'] },
      options.headers || {}
    );
    try {
      const res = await axios.get(url, {
        timeout: Number(options.timeout) || 30000,
        headers,
        responseType: options.stream ? 'stream' : undefined
      });
      return res;
      
    } catch (error) {
      this.logger.error('Fetch error:', error.message, url);
      if (options.retry > 0) {
        options.try = options.try || 0;
        options.try++;
        options.retry--;
        this.logger.debug(`Retry ${options.try}:`, url);
        return await this.axiosGetWithOptions(url, options);
      } else {
        return null;
      }
    }
  }

  toSavePath(url, filePathPattern) {
    if (filePathPattern.indexOf('%f') >= 0) {
      return filePathPattern.replace('%f', url.split('/').pop());
    } else {
      return filePathPattern;
    }
  }

  toFilePath(s, format='hierachy') {
    if (format === 'hierachy') {
      s = s.split('/').filter(s => !!s);
      s[0] = s[0].replace(':', '');
      if (s.length === 2) {
        s.push('index.html')
      }
      s = s.map(encodeURIComponent);
      if (s[s.length-1].length > 255) {
        s[s.length-1] = crypto.createHash('md5').update(s[s.length-1]).digest('hex');
      }
      s = path.join(...s);
      if (!s.match(/\.(htm|html|json|xhtml|xml|pdf|asp|aspx|php|png|gif|jpg|jpeg|svg|txt|zip|mov|avi|psd|rtf)$/)) {
        s = s + '.html';
      }
    } else if (format==='md5') {
      s = crypto.createHash('md5').update(s).digest('hex');
    }
    return s;
  }

}