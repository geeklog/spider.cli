##  Get HTML
```shell
spider get https://www.example.com
```

To make it pretty:

```shell
spider get https://www.example.com -p
```

## URL range

You can also fetch a range of pages with a url pattern

```shell
spider get 'https://news.ycombinator.com/news?p=[1..10]'
```

>  Noted: The range is both side inclusive because I think it's more intutive.

## Get links inside pages

- `-u` make sure the return result is unique.
- `-n <parallal>` the number of fetches that can be run at the same time.
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

```shell
spider css '#hnmain tr.athing td.title a => %text : @href' 'https://news.ycombinator.com/news?p=[1..5]'
```

You can also omit the extract pattern.

```shell
spider css '#hnmain tr.athing td.title a' 'https://...'
```

It's the same as

```shell
spider css '#hnmain tr.athing td.title a => %html' 'https://...'
```

## Follow Links

Your can specify a follow link pattern instead of using url range:

```shell
spider css '#hnmain tr.athing td.title a => %text : @href' 'https://news.ycombinator.com/news?p=1' --follow 'a.morelink => @href'
```

## Pipe

Be hold! Here comes the killer feature of pipe!

```shell
spider img https://www.cnbeta.com/ 1 -u | spider save './cnbetaImg/%f' -n 10
```

## Headless Browser

With those evasive react-orientive web development, it getting annoying for the spider industry, but luckily for us, there's a new dimension, a new era of automation, here we embrace the headless browser, a heavy artillery that ends the crawl war for good.

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
spider daemon css '.preview-card=>%html' https://www.30secondsofcode.org/js/p/1/
```

### Take a selfie:

```shell
spider daemon screenshot 'https://example.com' exampe.png
```

