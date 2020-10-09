const os = require('os');
const fs = require('fs-extra');

class ConfigLoader {

  constructor(path) {
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

  get(key) {
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

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  toggle(key, enable) {
    if (enable) {
      delete this.data.__disables[key];
    } else {
      this.data.__disables[key] = 1;
    }
    this.save();
  }
}

module.exports = ConfigLoader;