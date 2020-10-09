export default class Logger {

  level: string;

  constructor(level = 'none') {
    this.level = level;
  }

  debug(...args: any[]) {
    if (this.level === 'debug') {
      console.error(...args);
    }
  }

  warn(...args: any[]) {
    if (this.level === 'debug' || this.level === 'warn') {
      console.error(...args);
    }
  }

  error(...args: any[]) {
    if (this.level === 'debug' || this.level === 'warn' || this.level === 'error') {
      console.error(...args);
    }
  }

}