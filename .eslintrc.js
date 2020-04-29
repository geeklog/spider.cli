module.exports = {
  "extends": "eslint:recommended",
  "env": {
    "node": true,
    "es6": true
  },
  "parserOptions": {
    "ecmaVersion": 2017,
    "sourceType": "module"
  },
  "rules": {
    "indent": ["error", 2],
    "linebreak-style": ["error", "unix"],
    "quotes": [0],
    "no-unused-vars": [0],
    "no-cond-assign": [0],
    "no-constant-condition": [0]
  }
}