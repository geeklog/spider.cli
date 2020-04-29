## Installation

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

## Cache

- `-c <cachePath>` Specify a cachePath (or simply `-c`) to enable the cache functionality, if cachePath is not provided, default to the `os.tmpdir() + hierachy(url)`.

- `-e <expireTime>` Specify the cache expire time in seconds, default is 1 day , which is 864000 second.

```shell
spider get 'https://example.com' -c '~/.cache' 
```

## Get links inside pages

- `-u` make sure the returned result is unique.
- `-n <parallal>` the number of requests that can be run at the same time.
```bash
spider link 'https://news.ycombinator.com/news?p=[1..10]' -u -n 3
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

```shell
spider css '#hnmain tr.athing td.title a => %text : @href' 'https://news.ycombinator.com/news?p=[1..5]'
```

You can also omit the extract pattern.

```shell
spider css '#hnmain tr.athing td.title a' 'https://...'
```

It's the same as:

```shell
spider css '#hnmain tr.athing td.title a => %html' 'https://...'
```

Your can have multiple `=>` to make a item pipeline.

```shell
spider css '.doulist-item .doulist-subject > div.title > a => %text => trim' 'https://www.douban.com/doulist/1518270/?start=1&sort=time'
```

## Follow Links

Your can specify a follow link pattern instead of using url range:

```shell
spider css '#hnmain tr.athing td.title a => %text : @href' 'https://news.ycombinator.com/news?p=1' --follow 'a.morelink => @href'
```

## Pipe

Be hold! Here comes the killer feature,`spider.cli`is pipable!

```shell
spider img https://www.cnbeta.com/ 1 -u | spider save './cnbetaImg/%file' -n 10
```

```shell
spider link 'https://news.ycombinator.com/news?p=[1..10]' -u -n 3 | spider link -cu -n 20 -t 1000
```

## Headless Browser

With those evasive react-orientive web development, it getting annoying for the spider industry, but luckily for us, there's a new dimension, a new era of automation, here we embrace the headless browser, a heavy artillery that ends the crawl war for good (use puppeteer internally).

###Start a headless browser daemon

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

