const {stdin} = require('./cli');
const {flatten, isString} = require('lodash');

const concurrent = require('concurr').default;

exports.isURL = function(s) {
  return s && isString(s) && (s.startsWith('http:') || s.startsWith('https:') || s.startsWith('ftp:'));
}

exports.exandURL = function(url) {
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

exports.parseURL = function(url) {
  return {
    url,
    parts: url.split('/').slice(3).filter(Boolean),
    domain: url.split('/').slice(0, 3).join('/')
  };
}

exports.normalizeLink = function(url, link) {
  const { domain, parts: urlParts } = exports.parseURL(url);
  if (!link) {
    return link;
  }
  if (link.startsWith('http:') || link.startsWith('https:')) {
    return link;
  }
  if (link.startsWith('//')) {
    return 'https:' + link;
  }
  if (link.startsWith('/') || link.startsWith('..')) {
    if (link.startsWith('/')) {
      link = link.substring(1);
    }
    const linkParts = link.split('/');
    link = linkParts.map((part, i) => 
      part === '..' ? undefined : (
        part == '.' ? urlParts[i] : part
      )
    ) .filter(Boolean)
      .join('/');
  }
  const parsedLink = domain + '/' + link;
  return parsedLink;
}

exports.normalizeAllLinksInHtml = function(url, html) {
  html = html.replace(/src="(.+?)"/g, (_, link) => `src="${exports.normalizeLink(url, link)}"`);
  html = html.replace(/src=(\/.+?) /g, (_, link) => `src="${exports.normalizeLink(url, link)}"`);
  html = html.replace(/href="(.+?)"/g, (_, link) => `src="${exports.normalizeLink(url, link)}"`);
  return html;
}

exports.resolveURLs = async function(url) {
  if (url) {
    return exports.exandURL(url);
  } else {
    const urls = flatten(
      (await stdin())
        .split('\n')
        .filter(s => !!s)
        .map(s => exports.exandURL(s))
    );
    return urls;
  }
};

exports.removeAllTags = function(tag, html) {
  return html
    .replace(new RegExp(`<${tag}[\\s\\S]*?>.*?</${tag}>`, 'g'), '')
    .replace(new RegExp(`<${tag}[\\s\\S]+?/>`, 'g'), '')
    .replace(new RegExp(`<${tag}[\\s\\S]+?>`, 'g'), '')
}

exports.resolveMultipe = async (startUrls, options, _yield) => {
  const urls = await exports.resolveURLs(startUrls);
  const output = exports.uniqOutput(options.unique);
  const fn = async u => await _yield(u, output);
  exports.concurrently(options.parallel, urls, fn);
}

exports.concurrent = concurrent;

exports.concurrently = (n, vals, fn) => {
  const q = concurrent(n);
  for (const v of vals) {
    q.go(fn.bind(null, v));
  }
  return q;
};

exports.uniqOutput = (b) => {
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
