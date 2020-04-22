const Spider = require('../spider');
const {blue, green} = require('chalk');

const spider = new Spider({
  cache: true,
  retry: 3,
});

(async () => {
  const res = await spider.get('https://www.cnbeta.com');
  res.css('.items-area .item dl').each(dl => {
    const title = dl.css('dt a => %text').get();
    const desc = dl.css('dd p => %text').getall().join('\n');
    const link = dl.css('a => @href').get();
    if (!link.includes('cnbetacdn')) {
      console.log(green(title));
      console.log(desc);
      console.log(blue(link));
      console.log();
    }
  })
})()