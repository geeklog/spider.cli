const pretty = require('pretty');
const cheerio = require('cheerio');
const entities = new (require('html-entities').XmlEntities)();
const JQ = require('node-jq');
const {collectStream, isStream} = require('./stream');
const {parseURL, normalizeLink, normalizeAllLinksInHtml, removeAllTags} = require('./helper');

class CssSelector {

  constructor(content, options) {
    this.content = content;
    this.options = options;
    this.unescapeOrNot = s => this.options.unescape ? entities.decode(s) : s;
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
            '@([a-z|A-Z|0-9|-|_]+)': (_, s) => this.unescapeOrNot(el.attr(s)) || '',
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

class Response {

  constructor({url, data, res, options}) {
    this.url = url;
    this.domain = parseURL(url).domain;
    this.res = res;
    this.data = data || (res ? res.data : null);
    this.headers = res ? res.headers: null;
    this.options = options;
    this.code = res ? res.code : (data ? 200 : 404);
  }

  normalizeLink(link) {
    return normalizeLink(this.domain, link);
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
    if (this.options.normalizeLinks) {
      data = normalizeAllLinksInHtml(this.domain, data);
    }
    if (this.options.removeScripts) {
      data = removeAllTags('script', data);
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

module.exports = Response;