const util = require('util');
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
const os = require('os');
const {uniq, flatten, isArray, isString, isJSON, isFunction} = require('lodash');
const isStream = require('is-stream');
const pretty = require('pretty');
const cheerio = require('cheerio');
const crypto = require('crypto');
const entities = new (require('html-entities').XmlEntities)();
const JQ = require('node-jq');
const concurrent = require('concurr').default;
const stdin = require(path.join(__dirname, './stdin'));

const userAgents = {
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36',
  googlebot: 'Googlebot/2.1 (+http://www.googlebot.com/bot.html)',
  default: 'CURL'
};

function isURL(s) {
  return s && (s.startsWith('http:') || s.startsWith('https:') || s.startsWith('ftp:'));
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
  return q;
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

class Response {

  constructor({url, data, res, options}) {
    this.url = url;
    this.res = res;
    this.data = data || (res ? res.data : null);
    this.headers = res ? res.headers: null;
    this.options = options;
    this.unescapeOrNot = s => this.options.unescape ? entities.decode(s) : s;
    this.prettyJSONOrNot = s => this.options.format ? JSON.stringify(JSON.parse(s), null, 2) : s;
    this.prettyHTMLOrNot = s => this.options.format ? pretty(s) : s;
  }

  fixLink(link) {
    if (link.startsWith('http:') || link.startsWith('https:')) {
      return link;
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

  css(pattern) {
    let [selector, formatter] = pattern.split('=>').map(s => s.trim());
    const p = this.getData().then(data => {
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
      return results;
    });
    p.get = () => p.then((results) => results[0]);
    p.getall = () => p.then((results) => results);
    return p;

    function format(s, replacements) {
      for (const repl in replacements) {
        s = s.replace(new RegExp(repl, 'g'), (...args) => replacements[repl](...args));
      }
      return s;
    }
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
    p.get = () => p.then(links => links[0]);
    p.getall = () => p.then(links => links);
    return p;
  }

  images(group=0) {
    if (group === 0) {
      return this.css('img');
    } else if (group === 1) {
      return this.css('img => @src');
    } else {
      throw new Error('Invalid group: ' + group);
    }
  }

  pipe(stream) {
    if (!isStream(this.data)) {
      throw new Error('Data is not a stream, can\'t be piped!');
    }
    this.data.pipe(stream);
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

  static expand(url) {
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
  }

  async save(url, filePath, options) {
    options = Object.assign({}, {stream: true, cache: false}, options);
    // 检查文件是否存在
    // 如果是, 检查文件是部分下载还是全部下载,
    // 如果部分下载, 断点续传 (如果服务端支持的话) //TODO
    // 如果已经下载, 跳过, 不需要重新下载
    if (await fs.exists(filePath)) {
      return true;
    }
    let res = await this.get(url, options);
    
    await fs.ensureFile(filePath);
    res.pipe(fs.createWriteStream(filePath));
    try {
      await new Promise((resolve, reject) => {
        res.on('finish', resolve);
        res.on('error', e => reject(e))
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

  async jq(filter, dataOrCallback) {
    if (dataOrCallback === undefined) {
      const callback = dataOrCallback;
      return async (data) => {
        const res = JSON.parse(await this.JQ.run(filter, data, { input: 'json' }));
        callback(res);
      }
    }
    const data = dataOrCallback;
    return JSON.parse(await JQ.run(filter, data, { input: 'json' }));
  }
  
  async axiosGetWithOptions(url, options) {
    this.logger.debug('Get', url);
    try {
      const res = await axios.get(url, {
        timeout: Number(options.timeout) || 30000,
        headers: {
          'User-Agent': userAgents[options.userAgent || 'default']
        },
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
    }
    throw new Error('Invalid filePathPattern: ' + filePathPattern);
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