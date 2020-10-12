import { collectStdin } from './cli';
import { flatten, isString } from 'lodash';
import concurr from 'concurr';

export const concurrent = concurr;

export const isURL = function(s: string) {
  return s && isString(s) && (s.startsWith('http:') || s.startsWith('https:') || s.startsWith('ftp:'));
}

export const expandURL = function(url: string) {
  const range = url.match(/\[(\d+?)\.\.(\d+?)]/);
  if (!range) {
    return [url];
  }
  const [all,left,right] = range;
  const urls = [];
  for (let i=Number(left); i<=Number(right); i++) {
    urls.push(url.replace(all, `${i}`));
  }
  return urls;
}

export const parseURL = function(url) {
  return {
    url,
    parts: url.split('/').slice(3).filter(Boolean),
    domain: url.split('/').slice(0, 3).join('/')
  };
}

export const normalizeLink = function(url, link) {
  const { domain, parts: urlParts } = parseURL(url);
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

export const normalizeAllLinksInHtml = function(url, html) {
  html = html.replace(/src="(.+?)"/g, (_, link) => `src="${normalizeLink(url, link)}"`);
  html = html.replace(/src=(\/.+?) /g, (_, link) => `src="${normalizeLink(url, link)}"`);
  html = html.replace(/href="(.+?)"/g, (_, link) => `href="${normalizeLink(url, link)}"`);
  return html;
}

export const resolveURLs = async function(url: string) {
  if (url) {
    return expandURL(url);
  } else {
    const urls = flatten(
      (await collectStdin())
        .split('\n')
        .filter(s => !!s)
        .map(s => expandURL(s))
    );
    return urls;
  }
};

export const removeAllTags = function(tag, html) {
  return html
    .replace(new RegExp(`<${tag}[\\s\\S]*?>.*?</${tag}>`, 'g'), '')
    .replace(new RegExp(`<${tag}[\\s\\S]+?/>`, 'g'), '')
    .replace(new RegExp(`<${tag}[\\s\\S]+?>`, 'g'), '')
}

export const resolveMultipe = async (startUrls, options, _yield) => {
  const urls = await resolveURLs(startUrls);
  const output = uniqOutput(options.unique);
  const fn = async u => await _yield(u, output);
  concurrently(options.parallel, urls, fn);
}

export const concurrently = (n, vals, fn) => {
  const q = concurrent(n, {preserveOrder: true});
  for (const v of vals) {
    q.go(fn.bind(null, v));
  }
  return q;
};

export const uniqOutput = (b) => {
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

export const parseHeaders = desc => {
  if (!desc) {
    return {};
  }
  return desc.split('\\n').reduce((all, header) => {
    const [k, ...vs] = header.split(':');
    return Object.assign(all, {[k]: vs.join(':')});
  }, {});
}
