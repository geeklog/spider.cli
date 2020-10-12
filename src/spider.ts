import fs from 'fs-extra';
import axios, {ResponseType} from 'axios';
import path from 'path';
import os from 'os';
import { isString, merge } from 'lodash';
import cheerio from 'cheerio';
import crypto from 'crypto';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { collectStream, monitorStream } from './stream';
import { isURL, concurrently, expandURL } from './helper';
import { Response } from './response';
import Logger from './logger';
import userAgents from './useragent';
import ConfigLoader from './config';
import { Concurrent } from 'concurr';

export interface SpiderOption {
  cache?: string;
  stream?: boolean;
  expire?: number;
  headers?: {[index: string]: string}
}

export interface SpiderBatchRunOption extends SpiderOption {
  urls: string | string[];
  parallel?: number;
  unique?: boolean;
  follow?: string;
}

export default class Spider {

  static batchRun(
    options: SpiderBatchRunOption,
    action: (url: string, spider: Spider) => Promise<void>
  ): Concurrent {
    let urls: string[];
    if (typeof options.urls === 'string') {
      urls = expandURL(options.urls);
    } else {
      urls = options.urls;
    }
    const spider = new Spider({...options});
    const q = concurrently(options.parallel, urls, async u => {
      await action(u, spider);
    });
    spider.jobs = q;
    return q;
  }

  options: any;
  cfg: ConfigLoader;
  logger: Logger;
  jobs: Concurrent;

  constructor(options: any = {}) {
    this.options = options;
    this.cfg = new ConfigLoader('~/.spider.cli.json');
    this.logger = new Logger(options.log);
    this.cfg.load();

    if (this.options.cache === true) {
      this.options.cache = this.cfg.get('cachePath');
    }
  }

  async shell(url) {
    const res = await this.get(url, {stream: true});
    const repl = require('repl');
    const context = repl.start('> ').context;
    context.spider = this;
    context.res = res;
    context.$ = cheerio.load(res.data);
  }

  async save(url: string, filePath: string, options: any = {}) {
    if (!isURL(url)) {
      throw new Error('Malform URL:'+url);
    }
    options = Object.assign({}, this.options, {stream: true, cache: false}, options);
    // TODO
    // 1. 断点续传
    // 2. 多片段下载时, 使用文件缓存而不是内存缓存
    if (options.parts) {
      const buf = await this.multipartDownload(url, Number(options.parts), options);
      await fs.ensureFile(filePath);
      await fs.writeFile(filePath, buf);
      return;
    }

    let res = await this.get(url, options);

    if (!res.headers) {
      this.logger.error('Save Fail:', url, filePath, res);
      return;
    }

    const totalBytes = Number(res.headers['content-length']);

    options.onStart && options.onStart(totalBytes);

    await fs.ensureFile(filePath);
    res.pipe(fs.createWriteStream(filePath));
    
    try {
      // Waiting for transmition complete, because the scheduler need this
      // to do the rate limiting right.
      return monitorStream(res, {
        onProgress(downloadedBytes) {
          options.onProgress && options.onProgress(downloadedBytes, totalBytes);
        }
      });
    } catch(err) {
      if (options.retry > 0) {
        this.logger.debug('Retry:', url, filePath);
        options.try = options.try || 0;
        options.try ++;
        options.retry --;
        this.save(url, filePath, options);
      } else {
        this.logger.error('Save Fail:', err.message, url, filePath);
      }
    }
  }

  async followAll(urlOrCssPatterns, extract) {
    if (!Array.isArray(urlOrCssPatterns)) {
      throw new Error('urlOrCssPatterns must be an array');
    }
    const [startUrl, ...patterns] = urlOrCssPatterns;
    let url;
    const nextPage = async (res, patterns) => {
      let url;
      for (const pattern of patterns) {
        url = await res.css(pattern).get();
        if (url) {
          break;
        }
      }
      url = res.normalizeLink(url);
      return url;
    }
    
    let res = await this.get(startUrl);
    await extract(res);
    while (url = await nextPage(res, patterns)) {
      res = await this.get(url);
      await extract(res);
    }
  }

  async getBatch(url, check, _yield) {
    const range = url.match(/\[(\d+?)\.\.]/);
    if (!range) {
      throw new Error('Wrong pattern: ' + url);
    }
    let [all, i] = range;

    while (true) {
      const res = await this.get(url.replace(all, i));
      if (!await check(res)) {
        break;
      }
      await _yield(res);
      i++;
    }
  }
  
  async get(url: string, options: SpiderOption = {}) {
    if (!isURL(url)) {
      throw new Error(`Malform URL: ${url}`);
    }
    options = Object.assign({}, this.options, options);
    let {
      cache: useCache,
      stream: streamMode,
      expire: cacheExpire
    } = options;

    cacheExpire = cacheExpire || 0;

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
    const headers = Object.assign(
      {},
      { 'User-Agent': userAgents[options.userAgent || 'default'] },
      options.headers || {}
    );
    const https = require('https');
    let httpsAgent = new https.Agent({ rejectUnauthorized: false });
    this.logger.debug('Get', url);
    const proxyStr = this.cfg.get('proxy');
    if (proxyStr) {
      const parts = proxyStr.split(':');
      const port = parts.pop();
      const host = parts.join(':');
      httpsAgent = new SocksProxyAgent({
        host,
        port,
      });
      this.logger.debug('Using socks5 proxy:', proxyStr);
    }
    try {
      const res = await axios.get(url, {
        timeout: Number(options.timeout) || 30000,
        headers,
        httpsAgent,
        responseType: options.stream ? 'stream' : undefined
      });
      return res;
      
    } catch (error) {
      if (options.retry > 0) {
        options.try = options.try || 0;
        options.try++;
        options.retry--;
        this.logger.debug(`Retry ${options.try}:`, url);
        return await this.axiosGetWithOptions(url, options);
      } else {
        this.logger.error('Fetch error:', error.message, url);
        return null;
      }
    }
  }

  async multipartDownload(url, nParts, options) {
    const headers = Object.assign(
      { 'User-Agent': userAgents[options.userAgent || 'default'] },
      options.headers || {}
    );
    const fetchOptions = {
      timeout: Number(options.timeout) || 30000,
      headers,
      responseType: 'stream' as ResponseType
    };
    const res = await axios.head(url, fetchOptions);
    const totalBytes = Number(res.headers['content-length']) || 0;
    const acceptRange = res.headers['accept-ranges'];
    if (!totalBytes || !acceptRange || acceptRange === 'none')
      throw new Error('Multipart download not supported');
    
    const bytesPerRange = Math.floor(totalBytes / nParts);
    const ranges = [];
    for (let i=0; i<nParts; i++) {
      const start = i === 0 ? 0 : ranges[i-1][1] + 1;
      const end = i === nParts-1 ? totalBytes : start + bytesPerRange;
      const amount = end - start;
      ranges.push([start, end, amount]);
    }

    options.onStart && options.onStart(ranges.map(([_,__,total]) => total));

    const fetches = ranges.map(async ([start, end], i) => {
      const opt = merge(
        fetchOptions, {
          headers: {'Range': `bytes=${start}-${end}`}
        }
      );
      this.logger.debug('Get', url, opt);
      const res = await axios.get(url, opt);
      const data = await collectStream(res.data, {
        onProgress(curr, incr) {
          options.onProgress && options.onProgress(curr, incr, i);
        }
      });
      return data;
    });
    const datas = await Promise.all(fetches);
    const buf = Buffer.concat(datas);
    return buf;
  }

  toSavePath(url, filePathPattern) {
    if (filePathPattern.indexOf('%file') >= 0) {
      return filePathPattern.replace('%file', url.split('/').pop());
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