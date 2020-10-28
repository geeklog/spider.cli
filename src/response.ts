import pretty from 'pretty';
import cheerio from 'cheerio';
import mime from 'mime-types';
import * as entities from 'entities';
import * as JQ from 'node-jq';
import { collectStream, isStream } from './stream';
import { parseURL, normalizeLink, normalizeAllLinksInHtml, removeAllTags } from './helper';
import { CssSelector } from './selector';

export type ResponseConfig = {
  url: string;
  data?: any;
  res?: any;
  options?: any;
  cachePath?: string;
}

export type ResultPromise = Promise<any> & {
  get: () => Promise<any>;
  getall: () => Promise<any[]>;
  map: (fn: (item: CssSelector) => any) => Promise<any[]>;
  each: (fn: (item: CssSelector) => void) => Promise<void>;
}

export class SpiderResponse {

  url: string;
  domain: string;
  res: any;
  data: any;
  headers: any;
  options: any;
  code: number;
  cachePath: string;

  constructor({url, data, res, options, cachePath}: ResponseConfig) {
    this.url = url;
    this.domain = parseURL(url).domain;
    this.res = res;
    this.data = data || (res ? res.data : null);
    this.headers = res ? res.headers: null;
    this.options = options;
    this.code = res ? res.code : (data ? 200 : 404);
    this.cachePath = cachePath;
  }

  normalizeLink(link: string) {
    return normalizeLink(this.url, link);
  }

  async extension() {
    if (this.cachePath) {
      return this.cachePath.split('/').pop().split('?').shift().split('.').pop();
    } else {
      return mime.extension(this.headers['content-type']);
    }
  }

  async getData() {
    if (!this.data && !this.res) {
      return null;
    }
    let data = this.data || this.res.data;
    if (isStream(data)) {
      data = await collectStream(data);
    }
    if (this.options.pretty || this.options.removeScripts) {
      const $ = cheerio.load(data);
      $('script').remove();
      data = $.html();
    }
    if (this.options.pretty || this.options.removeHeads) {
      const $ = cheerio.load(data);
      $('head').remove();
      data = $.html();
    }
    if (this.options.pretty || this.options.removeStyles) {
      const $ = cheerio.load(data);
      $('style').remove();
      data = $.html();
    }
    if (this.options.pretty || this.options.removeComments) {
      const $ = cheerio.load(data);
      $('*')
        .filter(function() { return this.type === 'comment'; })
        .remove();
      data = $.root().html();
    }
    if (this.options.pretty || this.options.removeAttributes) {
      const $ = cheerio.load(data);
      const exclusive = ['href', 'src', 'title', 'id'];
      $('*').each(function() {
        for (let key of Object.keys(this.attribs)) {
          if (!exclusive.includes(key)) {
            delete this.attribs[key];
          }
        }
      });
      data = $.html();
    }
    if (this.options.pretty || this.options.normalizeLinks) {
      data = normalizeAllLinksInHtml(this.url, data);
    }
    if (this.options.pretty || this.options.decodeEntities) {
      data = entities.decodeHTML(data);
    }
    if (this.options.pretty || this.options.formatHtml) {
      data = pretty(data);
    }
    if (this.options.pretty || this.options.removeEmptyLines) {
      data = data.split('\n').filter(s => !!s.trim()).join('\n');
    }
    return data;
  }

  async jq(pattern: string) {
    const data = await this.getData();
    try {
      return await JQ.run(pattern, data, {input: 'json'});
    } catch(err) {
      console.error(err.stack);
    }
  }

  css(pattern: string): ResultPromise {
    const p: ResultPromise = this.getData().then(
      data => {
        const r = new CssSelector(data, this.options).css(pattern);
        if (r) {
          return r.getall();
        } else {
          console.error('NODATA', this.url, JSON.stringify(data));
        }
      }
    ) as any;
    p.get = () => p.then((results) => results[0]);
    p.getall = () => p.then((results) => results || []);
    p.map = fn => p.then((results) => {
      return (results || []).map(r => fn(new CssSelector(r, this.options)));
    });
    p.each = fn => p.then((results) => {
      (results || []).forEach(r => fn(new CssSelector(r, this.options)));
    });
    return p;
  }

  regex(re: RegExp, group=0): ResultPromise {
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
    }) as any;
    p.get = () => p.then((results) => results ? results[0] : null);
    p.getall = () => p.then((results) => results ? results : []);
    return p;
  }

  links(): ResultPromise {
    const p = this.css('a => @href').then(links => {
      if (!links) {
        return [];
      }
      return links.map(l => this.normalizeLink(l));
    });
    const r = p as ResultPromise;
    r.get = () => r.then(_ => _[0]);
    r.getall = () => r.then(_ => _);
    return r;
  };

  images(group=0): ResultPromise  {
    if (group != 0 && group != 1) {
      throw new Error('Invalid group: ' + group);
    }
    const p = this.css('img => ' + ['%html','@src'][group]).then(imgs => {
      if (!imgs) {
        return [];
      }
      if (group == 1) {
        return imgs.map(_ => this.normalizeLink(_)).filter(_ => !!_);
      }
    });
    const r = p as ResultPromise;
    r.get = () => r.then(_ => _[0]);
    r.getall = () => r.then(_ => _);
    return r;
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
