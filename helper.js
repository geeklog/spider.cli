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
    domain: url.split('/').slice(0, 3).join('/')
  };
}

exports.normalizeLink = function(domain, link) {
  if (!link) {
    return link;
  }
  if (link.startsWith('http:') || link.startsWith('https:')) {
    return link;
  }
  if (link.startsWith('//')) {
    return 'https:' + link;
  }
  if (link.startsWith('/')) {
    link = link.substring(1);
  }
  return domain + '/' + link;
}

exports.normalizeAllLinksInHtml = function(domain, html) {
  html = html.replace(/src="(.+?)"/g, (_, link) => `src="${exports.normalizeLink(domain, link)}"`);
  html = html.replace(/src=\/(.+?) /g, (_, link) => `src="${exports.normalizeLink(domain, '/'+link)}"`);
  html = html.replace(/href="(.+?)"/g, (_, link) => `src="${exports.normalizeLink(domain, link)}"`);
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
