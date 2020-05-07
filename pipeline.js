const concurrent = require('concurr');

class ConccurRunner {

  constructor({fn, concurr, flatten, all}) {
    this.fn = fn;
    this.concurr = concurr;
    this.flatten = flatten;
    this.all = all;
    this.q = concurrent.default(concurr);
    if (fn.onProgress) {
      this.q.one(fn.onProgress);
    }
    if (fn.opError) {
      this.q.error(fn.onError);
    }
    if (fn.onDone) {
      this.q.done(fn.onDone);
    }
  }

  async start(...args) {
    if (this.flatten) {
      for (const arg of args[0]) {
        this.q.go(async () => {
          await this.fn(arg, (...nextArgs) => {
            const next = this.all[this.all.indexOf(this) + 1];
            next.start(...nextArgs);
          })
        });
      }
    } else {
      this.q.go(async () => {
        await this.fn(...args, (...nextArgs) => {
          const next = this.all[this.all.indexOf(this) + 1];
          next.start(...nextArgs);
        })
      });
    }
  }

}

module.exports = class Pipeline {

  constructor() {
    this.pipeline = [];
  }
  
  pipe(fn, concurr=1) {
    this.pipeline.push(new ConccurRunner({
      fn,
      concurr,
      all: this.pipeline
    }));
    return this;
  }
  
  pipeAll(fn, concurr=1) {
    this.pipeline.push(new ConccurRunner({
      fn,
      concurr,
      flatten: true,
      all: this.pipeline
    }));
    return this;
  }
  
  start(fn, concurr=1) {
    this.pipeline.unshift(new ConccurRunner({
      fn,
      concurr,
      all: this.pipeline
    }));
    setTimeout(() => {
      this.pipeline[0].start();
    }, 0);
    return this;
  }

}
