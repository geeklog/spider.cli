import * as entities from 'entities';
import pretty from 'pretty';
import cheerio from 'cheerio';

export interface CSSSelectResult {
  get: () => any;
  getall: () => any[];
}

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

  css(pattern: string): CSSSelectResult {
    const formatAll = (el, formatters) => {
      let res: string;
      for (const formatter of formatters) {
        if (formatter === 'trim') {
          res = res.trim();
          continue;
        }
        if (formatter === 'trimLines') {
          res = res.split('\n').map(line => line.trim()).filter(line => !!line).join('\n');
          continue;
        }
        let matched;
        matched = formatter.match(/^head\((\d+)\)$/);
        if (matched) {
          res = res.substr(0, Number(matched[1]));
          continue;
        }
        matched = formatter.match(/^tail\((\d+)\)$/);
        if (matched) {
          res = res.substring(res.length - Number(matched[1]), res.length);
          continue;
        }

        res = format(formatter, {
          '@([a-z|A-Z|0-9|\\-|_]+)': (_, s) => this.unescapeOrNot(el.attr(s)) || '',
          '%html': () => this.unescapeOrNot(this.prettyHTMLOrNot($.html(el))),
          '%text': () => this.unescapeOrNot(el.text()),
          '%el': () => el[0],
          '%json': () => el[0].children.map(_ => this.prettyJSONOrNot(_.data)).join('\n')
        });
      }
      return res;
    }

    function format(s: string, replacements: any) {
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
    if (selector === '%' || selector === '%el' || selector === '%element' || selector === '') {
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