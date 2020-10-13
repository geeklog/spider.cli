export { progressing, multi_progressing as multiProgressing } from 'cliall/loading';
import readline from 'readline';
import { AsyncIterator, IteratorResult, PromiseHandler } from './types';

export const cmdrOptions = (o: any) => {
  const options: any = {};
  const skips = ['parent', 'domain', 'commands', 'program', 'options', 'Command', 'Option', 'rawArgs', 'args', 'CommanderError'];
  for (const k of Object.keys(o)) {
    if (skips.indexOf(k) >= 0 || k.startsWith('_')) {
      continue;
    }
    options[k] = o[k];
  }
  return options;
}

export const collectStdin = async function(): Promise<string> {
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

export const readlinesStdin = async function(options: {
  onLine?: (line: string) => void,
  onError?: (error: Error) => void,
  onDone?: () => void
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });
    rl.on('line', (line) => {
      options.onLine && options.onLine(line);
    });
    rl.on('close', () => {
      options.onDone && options.onDone();
    });
    rl.on('error', (error) => {
      options.onError && options.onError(error);
    });
  })
}

export const iterReadlinesStdin = (): AsyncIterator => {
  let lines: string[] = [];
  let promises: Array<PromiseHandler> = [];

  function next(): Promise<IteratorResult> {
    if (lines.length) {
      return Promise.resolve({value: lines.shift(), done: false});
    }
    return new Promise((resolve, reject) => {
      promises.push({resolve, reject});
    });
  }

  readlinesStdin({
    onLine(line) {
      if (promises.length) {
        promises.shift().resolve({ value: line, done: true });
      } else {
        lines.push(line);
      }
    },
    onDone() {
      while (promises.length) {
        promises.shift().resolve({ value: null, done: true });
      }
    },
    onError(error) {
      while (promises.length) {
        promises.shift().reject(error);
      }
    }
  });

  return { next }
}
