const Spider = require('../spider');
const {blue, green} = require('chalk');

const spider = new Spider({ cache: true, retry: 3 });

(async () => {
  let res = await spider.get('https://www.cnbeta.com');
  const csrfToken = encodeURIComponent(await res.css('meta[name=csrf-token]=>@content').get());
  const timestamp = new Date().getTime();
  await res.css('.items-area .item dl').each(dl => {
    const title = dl.css('dt a => %text').get();
    const desc = dl.css('dd p => %text').getall().join('\n');
    const link = dl.css('a => @href').get();
    if (!link.includes('cnbetacdn')) {
      console.log(green(title));
      console.log(desc);
      console.log(blue(link));
      console.log();
    }
  });

  for (let page = 2; page <= 5; page++) {
    const url = `https://www.cnbeta.com/home/more?&type=all&page=${page}&_csrf=${csrfToken}&_=${timestamp}`;
    res = await spider.get(url, {
      headers: {
        'authority': 'www.cnbeta.com',
        'referer': 'https://www.cnbeta.com/'
      }
    });
    const list = await res.jq('[.result.list | .[] | {desc: .hometext, title: .title, link: .url_show}]');
    for (const {title, desc, link} of list) {
      if (!link.includes('cnbetacdn')) {
        console.log(green(title));
        console.log(Spider.util.cleanupText(desc));
        console.log(blue(link));
        console.log();
      }
    }
  }
})()