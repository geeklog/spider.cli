const Spider = require('./spider');
const Pipeline = require('./pipeline');
const path = require('path');

const spider = new Spider({
  cache: true,
  retry: 3,
  log: 'debug'
});
const pipeline = new Pipeline();

const get_albums = async (_yield) => {
  spider.getBatch(
    'https://api.flickr.com/services/rest?primary_photo_extras=owner_name%2Cpath_alias%2Crealname%2Csizes%2Curl_sq%2Curl_q%2Curl_t%2Curl_s%2Curl_n%2Curl_w%2Curl_m%2Curl_z%2Curl_c%2Curl_l%2Curl_h%2Curl_k%2Curl_3k%2Curl_4k%2Curl_5k%2Curl_6k%2Cneeds_interstitial&page=[1..]&per_page=25&get_user_info=1&extras=can_share%2Ccan_download&user_id=61021753%40N02&viewerNSID=&method=flickr.photosets.getList&csrf=&api_key=6644b50f8259e7243e36c3787fec2519&format=json&hermes=1&hermesClient=1&reqId=959e5b6a&nojsoncallback=1nojsoncallback=1',
    async (res) => res.data && res.data.stat === 'ok',
    async (res) => {
      const albumIDs = await res.jq('[.photosets.photoset | .[] | .id]');
      for (const albumID of albumIDs) {
        _yield(albumID, `https://www.flickr.com/photos/biodivlibrary/albums/${albumID}`);
      }
    }
  );
};

const get_album_detail = async (albumID, albumURL, _yield) => {
  const albumRes = await spider.get(albumURL);
  const title = (await albumRes.css('.album-title => %text'))[0].trim();

  let i = 1;
  
  let apiURL = () => `https://api.flickr.com/services/rest?extras=can_addmeta%2Ccan_comment%2Ccan_download%2Ccan_share%2Ccontact%2Ccount_comments%2Ccount_faves%2Ccount_views%2Cdate_taken%2Cdate_upload%2Cdescription%2Cicon_urls_deep%2Cisfavorite%2Cispro%2Clicense%2Cmedia%2Cneeds_interstitial%2Cowner_name%2Cowner_datecreate%2Cpath_alias%2Crealname%2Crotation%2Csafety_level%2Csecret_k%2Csecret_h%2Curl_sq%2Curl_q%2Curl_t%2Curl_s%2Curl_n%2Curl_w%2Curl_m%2Curl_z%2Curl_c%2Curl_l%2Curl_h%2Curl_k%2Curl_3k%2Curl_4k%2Curl_f%2Curl_5k%2Curl_6k%2Curl_o%2Cvisibility%2Cvisibility_source%2Co_dims%2Cpubliceditability&per_page=25&page=${i}&get_user_info=1&primary_photo_extras=url_c%2C%20url_h%2C%20url_k%2C%20url_l%2C%20url_m%2C%20url_n%2C%20url_o%2C%20url_q%2C%20url_s%2C%20url_sq%2C%20url_t%2C%20url_z%2C%20needs_interstitial%2C%20can_share&jump_to=&photoset_id=${albumID}&viewerNSID=&method=flickr.photosets.getPhotos&csrf=&api_key=6644b50f8259e7243e36c3787fec2519&format=json&hermes=1&hermesClient=1&reqId=a35f2bcc&nojsoncallback=1`;
  
  let apiRes = await spider.get(apiURL());
  
  const ok = r => r.data && r.data.stat === 'ok';

  if (i === 1 && !ok(apiRes)) {
    (await albumRes.regex(/"o":{"displayUrl":"(\\\/\\\/live\.staticflickr\.com.+?_o.jpg)"/g, 1))
      .map(u => u.replace(/\\\//g, '/'))
      .map(u => u.replace('//', 'https://'))
      .forEach(u => _yield(title, u));
    return;
  }

  while (ok(apiRes)) {
    const imgURLs = await apiRes.jq('[.photoset.photo | .[] | .url_o]');
    for (const imgURL of imgURLs) {
      _yield(title, imgURL);
    }
    i++;
    apiRes = await spider.get(apiURL());
  }
};

const save_img = async (title, imgURL) => {
  const imgName = imgURL.split('/').pop();
  const filePath = path.join('/Volumes/Z/Flickr', title, imgName);
  console.log('saving:', filePath);
  await spider.save(imgURL, filePath);
};

save_img.onProgress = (_, success, fail, total) => {
  console.log(`save_img ${success}/${fail}/${total}`);
}
// save_img.onError = (err, success, fail, total) => {
//   console.error(`save_img ${success}/${fail}/${total}`, err);
// }
// save_img.onDone = () => {
//   console.error('save_img done');
// }

pipeline
  .start(get_albums)
  .pipe(get_album_detail, 3)
  .pipe(save_img, 20)
