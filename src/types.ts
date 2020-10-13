
export interface IteratorResult {
  value: any,
  done: boolean
}

export interface AsyncIterator {
  next: () => Promise<IteratorResult> | IteratorResult;
}

export interface ArrayLikeAsyncIterator {
  next: () => Promise<IteratorResult> | IteratorResult;
  toArray: () => Promise<any[]>
}

export interface PromiseHandler {
  resolve: (a) => void;
  reject: (e: Error) => void;
}

export async function forEachIter(iterator, fn: (val: any) => void | Promise<void>) {
  let n = await iterator.next();
  while (!n.done) {
    await fn(n.value);
    n = await iterator.next();
  }
}

export function iter2Arrayable(iterator: AsyncIterator): ArrayLikeAsyncIterator {
  return Object.assign({}, iterator, {
    async toArray() {
      const arr = [];
      await forEachIter(iterator, (val) => {
        arr.push(val);
      });
      return arr;
    }
  });
}