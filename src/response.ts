import pretty from 'pretty';
import cheerio from 'cheerio';
import * as entities from 'entities';
import JQ from 'node-jq';
import { collectStream, isStream } from './stream';
import { parseURL, normalizeLink, normalizeAllLinksInHtml, removeAllTags } from './helper';

export class CssSelector {
  data(data: any): any {
    throw new Error('Method not implemented.');
  }
  pipe(arg0: any) {
    throw new Error('Method not implemented.');
  }
  content: any;
  options: any;
  unescapeOrNot: (s: any) => any;
  prettyJSONOrNot: (s: any) => any;
  prettyHTMLOrNot: (s: any) => any;
  headers: any;

  constructor(content?: any, options?: any) {
    this.content = content;
    this.options = options;
    this.unescapeOrNot = s => this.options.unescape ? entities.decodeHTML(s) : s;
    this.prettyJSONOrNot = s => this.options.pretty ? JSON.stringify(JSON.parse(s), null, 2) : s;
    this.prettyHTMLOrNot = s => this.options.pretty ? pretty(s) : s;
  }

  css(pattern) {
    const formatAll = (el, formatters) => {
      let res;
      for (const formatter of formatters) {
        if (formatter === 'trim') {
          res = res.trim();
        } else if (formatter === 'trimLines') {
          res = res.split('\n').map(line => line.trim()).filter(line => !!line).join('\n');
        } else {
          res = format(formatter, {
            '@([a-z|A-Z|0-9|\\-|_]+)': (_, s) => this.unescapeOrNot(el.attr(s)) || '',
            '%html': () => this.unescapeOrNot(this.prettyHTMLOrNot($.html(el))),
            '%text': () => this.unescapeOrNot(el.text()),
            '%el': () => el[0],
            '%json': () => el[0].children.map(_ => this.prettyJSONOrNot(_.data)).join('\n')
          });
        }
      }
      return res;
    }

    function format(s, replacements) {
      for (const repl in replacements) {
        s = s.replace(new RegExp(repl, 'g'), (...args) => replacements[repl](...args));
      }
      return s;
    }

    let [selector, ...formatters] = pattern.split('=>').map(s => s.trim());
    const data = this.content;
    if (!data) {
      return null;
    }
    const $ = cheerio.load(data);
    const results = [];
    if (!formatters.length) {
      formatters = ['%html'];
    }
    if (selector === '%el') {
      results.push(formatAll($($('*')[0]), formatters));
    } else {
      for (const el of $(selector).toArray().map($)) {
        results.push(formatAll(el, formatters));
      }
    }
    
    return {
      get: () => results[0],
      getall: () => results
    };
  }
}

export type ResponseConfig = {
  url: string;
  data?: any;
  res?: any;
  options?: any;
}

export class Response {
  url: any;
  domain: any;
  res: any;
  data: any;
  headers: any;
  options: any;
  code: any;

  constructor({url, data, res, options}: ResponseConfig) {
    this.url = url;
    this.domain = parseURL(url).domain;
    this.res = res;
    this.data = data || (res ? res.data : null);
    this.headers = res ? res.headers: null;
    this.options = options;
    this.code = res ? res.code : (data ? 200 : 404);
  }

  normalizeLink(link) {
    return normalizeLink(this.url, link);
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

  async jq(pattern) {
    const data = await this.getData();
    try {
      return JSON.parse((await JQ.run(pattern, data)) as any);
    } catch(err) {
      console.error(err, data);
    }
  }

  css(pattern) {
    const p = this.getData().then(
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
    }) as any;
    p.get = () => p.then((results) => results ? results[0] : null);
    p.getall = () => p.then((results) => results ? results : []);
    return p;
  }

  links() {
    const p = this.css('a => @href').then(links => {
      if (!links) {
        return [];
      }
      return links.map(l => this.normalizeLink(l));
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
        return imgs.map(_ => this.normalizeLink(_)).filter(_ => !!_);
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
