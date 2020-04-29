const Spider = require('../spider');
const {blue, green} = require('chalk');

(async () => {
  const spider = new Spider({
    cache: true,
    retry: 3,
  });
  const extract = async (res) => {
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
  }
  let url = 'https://www.douban.com/doulist/1518270/?start=1&sort=time';
  let res = await spider.get(url);
  await extract(res);
  while (url = await res.css('#content > div > div.article > div.paginator > span.next > a => @href').get()) {
    res = await spider.get(url);
    await extract(res);
  }
})()
