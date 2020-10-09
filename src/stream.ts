import stream from 'stream';
import is_stream from 'is-stream';

export const isStream = is_stream;

type StreamMonitor = {
  onProgress?: (progress: number, totalLength: number) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
};

/**
 * Actively pull the stream to collect data.
 */
export const collectStream = async function(stream, options: StreamMonitor = {}): Promise<Buffer> {
  const chunks = [];
  let progress = 0;
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => {
      chunks.push(chunk);
      progress += chunk.length;
      options.onProgress && options.onProgress(progress, chunk.length);
    });
    stream.on('end', () => {
      options.onDone && options.onDone();
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', (err) => {
      options.onError && options.onError(err);
      reject(err);
    });
  });
}

/**
 * Monitor the progress of stream transmission,
 * but not actively pull the stream.
 */
export const monitorStream = async function(source, options: StreamMonitor = {}) {
  return new Promise((resolve, reject) => {
    const w = new stream.Writable();
    let progress = 0;
    w._write = (chunk, encoding, next) => {
      progress += chunk.length;
      options.onProgress && options.onProgress(progress, chunk.length);
      next();
    }
    w.end = () => {
      options.onDone && options.onDone();
      resolve();
    };
    w.on('error', (err) => {
      options.onError && options.onError(err);
      reject(err);
    });
    source.pipe(w);
  });
}