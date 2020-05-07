
const clui = require('clui');
const clear = require('clear');
const prettyBytes = require('pretty-bytes');
const cliCursor = require('cli-cursor');

exports.progressBar = () => ({
  start() {
    cliCursor.toggle(false);
  },
  progress(curr, total) {
    clear();
    const human = `${prettyBytes(curr)} / ${prettyBytes(total)}`;
    console.log(clui.Gauge(curr, total, 20, total * 0.8, human));
  },
  stop() {
    cliCursor.toggle(true);
  }
});

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