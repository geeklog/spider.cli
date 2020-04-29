/**
 * 抓取豆瓣 imdb 前250 电影资料
 * https://www.douban.com/doulist/1518270/?start=2&sort=time
 */
const Spider = require('../spider');
const {blue, green} = require('chalk');

const spider = new Spider({ cache: true, retry: 3 });
spider.followAll([
  'https://www.douban.com/doulist/1518270/?start=1&sort=time',
  '#content > div > div.article > div.paginator > span.next > a => @href'
], async res => {
  await res.css('.doulist-item .doulist-subject > div.title').each(async a => {
    const title = a.css('a => %text => trim').get();
    const pageLink = a.css('a => @href').get();
    
    const pageRes = await spider.get(pageLink);
    const summary = await pageRes.css('span[property="v:summary"] => %text => trimLines').get();

    console.log(green(title));
    console.log(blue(pageLink));
    console.log(summary);
    console.log();
  });
});
