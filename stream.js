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