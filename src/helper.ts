import { iterReadlinesStdin } from './cli';
import { isString } from 'lodash';
import {iter2Arrayable, ArrayLikeAsyncIterator} from './types';

export const isURL = function(s: string) {
  return s && isString(s) && (s.startsWith('http:') || s.startsWith('https:') || s.startsWith('ftp:'));
}

/**
 * Expand urls, Will return an iterator.
 * 
 * The urls can be either of (undefined | string | string[])
 * - undefined: urls read from stdin line by line.
 * - string[]: iterate through the url array.
 * - string: can be a single url or a url pattern.
 *  - url pattern
 *    - [start..end]  from start to end
 *    - [start..step..end] from start to end with incremental step
 *    - [start..] from start to infinity
 *    - [start..step..] from start to infinity with incremental step
 * 
 * @param url 
 */
export const expandURL = function(url?: string | string[]) : ArrayLikeAsyncIterator {
  if (!url) {
    return iter2Arrayable(iterReadlinesStdin());
  }

  let all: string;
  let start: number;
  let end: number;
  let step = 1;

  if (!(typeof url === 'string')) {
    start = 0;
    end = url.length - 1;
    let nextIndex = start;
    return iter2Arrayable({
      next() {
        let result: {value: string, done: boolean};
        if (nextIndex <= end) {
          result = {
            value: url[nextIndex],
            done: false
          }
          nextIndex += step;
          return result;
        }
        return { value: url[nextIndex], done: true }
      }
    });
  }

  let range = url.match(/\[(\d+?)\.\.(\d*?)]/);
  let range2 = url.match(/\[(\d+?)\.\.(\d+?)\.\.(\d*?)]/);
  if (!range && !range2) {
    return iter2Arrayable({ 
      next() {
        return {value: url, done: true}
      }
    });
  }
  
  if (range) {
    all = range[0];
    start = Number(range[1]);
    end = Number(range[2]) || Infinity;
  }
  if (range2) {
    all = range2[0];
    start = Number(range2[1]);
    step = Number(range2[2]);
    end = Number(range2[3]) || Infinity;
  }

  let nextIndex = start;
  let iterationCount = 0;

  return iter2Arrayable({
    next() {
      let result: {value: string, done: boolean};
      if (nextIndex <= end) {
        result = {
          value: url.replace(all, ''+nextIndex),
          done: false
        }
        nextIndex += step;
        iterationCount++;
        return result;
      }
      return { value: url.replace(all, ''+iterationCount), done: true }
    }
  });
}

export const parseURL = function(url: string) {
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

export const removeAllTags = function(tag, html) {
  return html
    .replace(new RegExp(`<${tag}[\\s\\S]*?>.*?</${tag}>`, 'g'), '')
    .replace(new RegExp(`<${tag}[\\s\\S]+?/>`, 'g'), '')
    .replace(new RegExp(`<${tag}[\\s\\S]+?>`, 'g'), '')
}

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
