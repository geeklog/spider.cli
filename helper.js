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
