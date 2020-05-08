
const clui = require('clui');
const clear = require('clear');
const prettyBytes = require('pretty-bytes');
const cliCursor = require('cli-cursor');
const {multi_progressing, progressing} = require('cliall/loading');

exports.multiProgressing = multi_progressing;

exports.progressing = progressing;

exports.cmdrOptions = o => {
  const options = {};
  const skips = ['commands', 'options', 'Command', 'Option', 'rawArgs', 'args'];
  for (const k of Object.keys(o)) {
    if (skips.indexOf(k) >= 0 || k.startsWith('_')) {
      continue;
    }
    options[k] = o[k];
  }
  return options;
}

exports.stdin = async function() {
  return new Promise((resolve, reject) => {
    process.stdin.on('error', (err) => {
      reject(err);
    });
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.resume();
  });
}
