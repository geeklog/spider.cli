
const stream = require('stream');

exports.isStream = require('is-stream');

exports.collectStream = async function(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => {
      chunks.push(chunk);
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', (err) => {
      reject(err);
    });
  });
}

exports.monitorStream = async function(source, options) {
  return new Promise((resolve, reject) => {
    const w = new stream.Writable();
    let progress = 0;
    w._write = (chunk, encoding, next) => {
      progress += chunk.length;
      options.onProgress && options.onProgress(progress);
      next();
    }
    w.end = resolve;
    w.on('error', reject);
    source.pipe(w);
  });
}