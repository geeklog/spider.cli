import os from 'os';
import fs from 'fs-extra';

export default class ConfigLoader {
  path: string;
  data: { __disables: {}; };

  constructor(path: string) {
    this.path = path = path.replace('~', os.homedir());
    this.data = {
      __disables: {}
    };
  }

  load() {
    fs.ensureFileSync(this.path);
    const jsonStr = fs.readFileSync(this.path).toString();
    if (jsonStr) {
      this.data = JSON.parse(jsonStr);
      this.data.__disables = this.data.__disables || {};
    }
  }

  save () {
    this.data.__disables = this.data.__disables || {};
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  get(key: string) {
    if (key === '*') {
      let dup = {};
      for (let k in this.data) {
        if (k !== '__disables') {
          dup[k] = this.data[k];
        }
      }
      return dup;
    }
    if (this.data.__disables[key]) {
      return undefined;
    }
    return this.data[key];
  }

  set(key: string, value: any) {
    this.data[key] = value;
    this.save();
  }

  toggle(key: string, enable: boolean) {
    if (enable) {
      delete this.data.__disables[key];
    } else {
      this.data.__disables[key] = 1;
    }
    this.save();
  }
}