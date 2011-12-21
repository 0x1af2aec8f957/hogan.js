# Explain

> ESM version of hogan.js

+ [mustache.js](https://github.com/janl/mustache.js)
+ [hogan.js](https://github.com/twitter/hogan.js)

## Use
### support Deno

```javascript
import Hogan from 'https://raw.githubusercontent.com/0x1af2aec8f957/hogan.js/deno/lib/hogan.js';

var data = {
  screenName: "dhg",
};

var template = Hogan.compile("Follow @{{screenName}}.");
var output = template.render(data);

// prints "Follow @dhg."
console.log(output);
```
