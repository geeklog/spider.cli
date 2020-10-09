module.exports = class Logger {
  constructor(level = 'none') {
    this.level = level;
  }
  debug(...args) {
    if (this.level === 'debug') {
      console.error(...args);
    }
  }
  warn(...args) {
    if (this.level === 'debug' || this.level === 'warn') {
      console.error(...args);
    }
  }
  error(...args) {
    if (this.level === 'debug' || this.level === 'warn' || this.level === 'error') {
      console.error(...args);
    }
  }
}