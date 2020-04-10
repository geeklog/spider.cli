const os = require('os');
const fs = require('fs-extra');

module.exports = function (path) {
  path = path.replace('~', os.homedir());
  return {
    data: {},
    load () {
      fs.ensureFileSync(path);
      const jsonStr = fs.readFileSync(path).toString()
      if (jsonStr) {
        this.data = JSON.parse(jsonStr);
      }
    },
    save () {
      fs.writeFileSync(path, JSON.stringify(this.data, null, 2));
    }
  }
}
