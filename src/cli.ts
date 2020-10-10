export { progressing, multi_progressing as multiProgressing } from 'cliall/loading';
import readline from 'readline';

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

export const readlinesStdin = async function(onLineCallback: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });
    rl.on('line', (line) => {
      onLineCallback(line);
    });
    rl.on('close', () => {
      resolve();
    });
    rl.on('error', (error) => {
      reject(error);
    });
  })
  
}
