
exports.level = 'none';

exports.debug = function(...args) {
  const level = exports.level;
  if (level === 'debug') {
    console.log(...args);
  }
}

exports.warn = function(...args) {
  const level = exports.level;
  if (level === 'warn') {
    console.log(...args);
  }
}

exports.error = function(...args) {
  const level = exports.level;
  if (level === 'debug' || level === 'error') {
    console.log(...args);
  }
}