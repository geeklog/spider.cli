# Spider for Commandline and Programming API

This is a spider for command line.

If you found any problems, welcome to open issues on [Github](https://github.com/geeklog/spider.cli). Stars would be appreciated.

## Installation

### Build from local

```shell
npm i
npm run build && npm run pub-dev
```

### Install from NPM
```shell
npm i -g spider.cli
```

## Usage

```shell
spider --help
```

##  Get HTML

```shell
spider get https://www.example.com
```

## Request Options

- `-p` Prettify the html.
- `-t <timeout>` Specify the timeout of request (in milliseconds).
- `-r <retryTimes>` Specify retry times.
- `-x <headers>` Custom request headers `k:v\nk:v`
```shell
spider get https://www.example.com -t 3000 -r 3 -p -x 'Referer:https://none.org\nX-Token:ssxxaa'
```


## URL range

You can also fetch a range of pages with a url pattern

```shell
spider get 'https://news.ycombinator.com/news?p=[1..10]'
```

>  Note: The range is both side inclusive because it's more intutive.

You can even make infinite requests by Omit the end side

```shell
spider get 'https://news.ycombinator.com/news?p=[1..]'
```

You can also specify a step:

```shell
spider get 'https://news.ycombinator.com/news?p=[1..2..20]'
```

Can also have step in Infinite requests

```shell
spider get 'https://news.ycombinator.com/news?p=[1..2..]'
```

## Cache

- `-c <cachePath>` Specify a cachePath (or simply `-c`) to enable the cache functionality, if cachePath is not provided, default to the `APP_DATA_PATH + hierachy(url)`.

The `APP_DATA_PATH` is located on one of these path depend on your OS:
  - OS X - '/Users/user/Library/Application Support'
  - Windows 8 - 'C:\Users\user\AppData\Roaming'
  - Windows XP - 'C:\Documents and Settings\user\Application Data'
  - Linux - '/home/user/.local/share'

- `-e <expireTime>` Specify the cache expire time in seconds, default is 1 day , which is 864000 second.

```shell
spider get 'https://example.com' -c '~/.cache' 
```

## Get links inside pages

- `-i` make sure the returned result is unique.
- `-n <parallal>` the number of requests that can be run at the same time.
```bash
spider link 'https://news.ycombinator.com/news?p=[1..10]' -i -n 3
```

## Get images inside pages

This will give you all the image tags inside html page.

```shell
spider img 'https://multiple.image.com'
```

If you only want the url from `src` attribute, specify a extractionLevel=1

```shell
spider img 'https://multiple.image.com' 1
```

## Use shell to debug your request

Support `await` async flow.
```shell
spider shell https://www.example.com
> await res.css('.main').getall()
```

## Extract data using CSS selector

CSS selector followed by a `=>`, followed by a extract pattern:

- `%text` means extract the inner text.
- `%html` means the outer html.
- `@attr` starts with `@` means extract the attribute.
- `trim` trim the text, prev item must be a string.
- `head(n)` take the first n chars of the text, prev item must be a string.
- `tail(n)` take the last n chars of the text, prev item must be a string.

```shell
spider css '#hnmain tr.athing td.title a => %text : @href' 'https://news.ycombinator.com/news?p=[1..5]'
```

You can also omit the extract pattern.

```shell
spider css '#hnmain tr.athing td.title a' 'https://news.ycombinator.com/news'
```

It's the same as:

```shell
spider css '#hnmain tr.athing td.title a => %html' 'https://news.ycombinator.com/news'
```

Omitting the selector part means select the element itself, only use in subselection.

```typescript
import Spider from 'spider.cli';

const spider = new Spider();
const res = await spider.get('https://news.ycombinator.com/');
await res.css('tr.athing').each((tr) => {
  console.log(tr.css('=> %text').get());
  console.log(tr.css('a => @href').getall());
});
```

`=> %text` is the same as `%el => %text`, `%element => %text`, `% => %text`

Your can have multiple `=>` to make a item pipeline.

```shell
spider css '.doulist-item .doulist-subject > div.title > a => %text => trim' 'https://www.douban.com/doulist/1518270/?start=1&sort=time'
```

## Follow Links

Your can specify a follow link pattern instead of using url range:

```shell
spider css '#hnmain tr.athing td.title a => %text : @href' 'https://news.ycombinator.com/news?p=1' --follow 'a.morelink => @href'
```

## Save Files

- `-v progress` show the download progress.
- `-d <parts>` use multipart downloader to speed up the download.

```
spider save cat.jpg 'https://i.imgur.com/z4d4kWk.jpg'
spider save cat.jpg 'https://i.imgur.com/z4d4kWk.jpg' -v progress
spider save BD3A.pdf 'https://users.aalto.fi/~ave/BDA3.pdf' -d 10
spider save BD3A.pdf 'https://users.aalto.fi/~ave/BDA3.pdf' -d 10 -v progress
```

## Pipe

Be hold! Here comes the killer feature,`spider.cli`is pipable!

- Download all the images from a certain web page:

```shell
spider img https://www.cnbeta.com/ 1 -i | spider save './cnbetaImg/%file' -n 10
```

- Extract links from Hackernews pages ranges from 1 to 10, then visit those link and extract links inside those pages.

```shell
spider link 'https://news.ycombinator.com/news?p=[1..10]' -i -n 3 | spider link -cu -n 20 -t 1000
```

## Headless Browser

With those evasive react-orientive web development, it getting annoying for the spider industry, but luckily for us, there's a new dimension, a new era of automation, here we embrace the headless browser, a heavy artillery that ends the crawl war for good (use puppeteer internally).

### Install
You need to install Puppeteer yourself before use the headless browser, it's not installed beforehand because it required a headless chrome instance which take up about 100M disk space that might make the install process slow to crawl depending on you internet speed.

```
npm i puppeteer
```

### Start a headless browser daemon

```shell
spider daemon start
```

### Likewise, Stop

```shell
spider daemon stop
```

### Is it running?

```shell
spider daemon status
```

### Let's do something useful:

```shell
spider daemon css '.preview-card=>%html' 'https://www.30secondsofcode.org/js/p/[1..10]/'
```

### Take a selfie:

```shell
spider daemon screenshot 'https://example.com' exampe.png
```

### Take a bunch of selfies:

```shell
spider daemon screenshot 'https://example.com/[1..10]' 'screenshot/%file'
```

