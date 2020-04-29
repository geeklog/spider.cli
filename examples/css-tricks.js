const Spider = require('../spider');
const {blue, green} = require('chalk');

(async () => {
  const spider = new Spider({ cache: true, retry: 3, log: 'debug' });
  spider.followAll([
    'https://css-tricks.com/',
    '#maincontent > div.articles-and-rail > div > a => @href',
    '#all-site-wrap > main > nav > div > ul > li.breadcrumbs-next-page > a => @href'
  ], async (res) => {
    await res.css('.article-article').each(async a => {
      const title = a.css('h2 a => %text => trim').get();
      const link = a.css('h2 a => @href').get();
      console.log(green(title));
      console.log(blue(link));
      console.log();
    });
  });
})()
