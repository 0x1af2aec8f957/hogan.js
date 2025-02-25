/*
 *  Copyright 2011 Twitter, Inc.
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

const rAmp = /&/g,
  rLt = /</g,
  rGt = />/g,
  rApos = /\'/g,
  rQuot = /\"/g,
  hChars = /[&<>\"\']/;

//Find a key in an object
function findInScope(key, scope, doModelGet) {
  let val;

  if (scope && typeof scope == 'object') {

    if (scope[key] !== undefined) {
      val = scope[key];

      // try lookup with get for backbone or similar model data
    } else if (doModelGet && scope.get && typeof scope.get == 'function') {
      val = scope.get(key);
    }
  }

  return val;
}

function createSpecializedPartial(instance, subs, partials, stackSubs, stackPartials, stackText) {
  function PartialTemplate() {};
  PartialTemplate.prototype = instance;
  function Substitutions() {};
  Substitutions.prototype = instance.subs;
  let key;
  const partial = new PartialTemplate();
  partial.subs = new Substitutions();
  partial.subsText = {};  //hehe. substext.
  partial.buf = '';

  stackSubs = stackSubs || {};
  partial.stackSubs = stackSubs;
  partial.subsText = stackText;
  for (key in subs) {
    if (!stackSubs[key]) stackSubs[key] = subs[key];
  }
  for (key in stackSubs) {
    partial.subs[key] = stackSubs[key];
  }

  stackPartials = stackPartials || {};
  partial.stackPartials = stackPartials;
  for (key in partials) {
    if (!stackPartials[key]) stackPartials[key] = partials[key];
  }
  for (key in stackPartials) {
    partial.partials[key] = stackPartials[key];
  }

  return partial;
}

function coerceToString(val) {
  return String((val === null || val === undefined) ? '' : val);
}

function hoganEscape(str) {
  str = coerceToString(str);
  return hChars.test(str) ?
    str
      .replace(rAmp, '&amp;')
      .replace(rLt, '&lt;')
      .replace(rGt, '&gt;')
      .replace(rApos, '&#39;')
      .replace(rQuot, '&quot;') :
    str;
}

const isArray = Array.isArray || function(a) {
  return Object.prototype.toString.call(a) === '[object Array]';
};

export default {
  Template: class {
    constructor(codeObj = {}, text, compiler, options){
      this.r = codeObj.code || this.r;
      this.c = compiler;
      this.options = options || {};
      this.text = text || '';
      this.partials = codeObj.partials || {};
      this.subs = codeObj.subs || {};
      this.buf = '';
    }

    r (context, partials, indent) { return ''; }

    // variable escaping
    v = hoganEscape

    // triple stache
    t = coerceToString

    render(context, partials, indent) {
      return this.ri([context], partials || {}, indent);
    }

    // render internal -- a hook for overrides that catches partials too
    ri(context, partials, indent) {
      return this.r(context, partials, indent);
    }

    // ensurePartial
    ep(symbol, partials) {
      const partial = this.partials[symbol];

      // check to see that if we've instantiated this partial before
      let template = partials[partial.name];
      if (partial.instance && partial.base == template) {
        return partial.instance;
      }

      if (typeof template == 'string') {
        if (!this.c) {
          throw new Error("No compiler available.");
        }
        template = this.c.compile(template, this.options);
      }

      if (!template) {
        return null;
      }

      // We use this to check whether the partials dictionary has changed
      this.partials[symbol].base = template;

      if (partial.subs) {
        // Make sure we consider parent template now
        if (!partials.stackText) partials.stackText = {};
        for (const key in partial.subs) {
          if (!partials.stackText[key]) {
            partials.stackText[key] = (this.activeSub !== undefined && partials.stackText[this.activeSub]) ? partials.stackText[this.activeSub] : this.text;
          }
        }
        template = createSpecializedPartial(template, partial.subs, partial.partials,
          this.stackSubs, this.stackPartials, partials.stackText);
      }
      this.partials[symbol].instance = template;

      return template;
    }

    // tries to find a partial in the current scope and render it
    rp(symbol, context, partials, indent) {
      const partial = this.ep(symbol, partials);
      if (!partial) {
        return '';
      }

      return partial.ri(context, partials, indent);
    }

    // render a section
    rs(context, partials, section) {
      const tail = context[context.length - 1];

      if (!isArray(tail)) {
        section(context, partials, this);
        return;
      }

      for (let i = 0; i < tail.length; i++) {
        context.push(tail[i]);
        section(context, partials, this);
        context.pop();
      }
    }

    // maybe start a section
    s(val, ctx, partials, inverted, start, end, tags) {
      let pass;

      if (isArray(val) && val.length === 0) {
        return false;
      }

      if (typeof val == 'function') {
        val = this.ms(val, ctx, partials, inverted, start, end, tags);
      }

      pass = !!val;

      if (!inverted && pass && ctx) {
        ctx.push((typeof val == 'object') ? val : ctx[ctx.length - 1]);
      }

      return pass;
    }

    // find values with dotted names
    d(key, ctx, partials, returnFound) {
      let found,
        names = key.split('.'),
        val = this.f(names[0], ctx, partials, returnFound),
        doModelGet = this.options.modelGet,
        cx = null;

      if (key === '.' && isArray(ctx[ctx.length - 2])) {
        val = ctx[ctx.length - 1];
      } else {
        for (let i = 1; i < names.length; i++) {
          found = findInScope(names[i], val, doModelGet);
          if (found !== undefined) {
            cx = val;
            val = found;
          } else {
            val = '';
          }
        }
      }

      if (returnFound && !val) {
        return false;
      }

      if (!returnFound && typeof val == 'function') {
        ctx.push(cx);
        val = this.mv(val, ctx, partials);
        ctx.pop();
      }

      return val;
    }

    // find values with normal names
    f(key, ctx, partials, returnFound) {
      let val = false,
        v = null,
        found = false,
        doModelGet = this.options.modelGet;

      for (let i = ctx.length - 1; i >= 0; i--) {
        v = ctx[i];
        val = findInScope(key, v, doModelGet);
        if (val !== undefined) {
          found = true;
          break;
        }
      }

      if (!found) {
        return (returnFound) ? false : "";
      }

      if (!returnFound && typeof val == 'function') {
        val = this.mv(val, ctx, partials);
      }

      return val;
    }

    // higher order templates
    ls(func, cx, ctx, partials, text, tags) {
      const oldTags = this.options.delimiters;

      this.options.delimiters = tags;
      this.b(this.ct(coerceToString(func.call(cx, text, ctx)), cx, partials));
      this.options.delimiters = oldTags;

      return false;
    }

    // compile text
    ct(text, cx, partials) {
      if (this.options.disableLambda) {
        throw new Error('Lambda features disabled.');
      }
      return this.c.compile(text, this.options).render(cx, partials);
    }

    // template result buffering
    b(s) { this.buf += s; }

    fl() { let r = this.buf; this.buf = ''; return r; }

    // method replace section
    ms(func, ctx, partials, inverted, start, end, tags) {
      let textSource,
        cx = ctx[ctx.length - 1],
        result = func.call(cx);

      if (typeof result == 'function') {
        if (inverted) {
          return true;
        } else {
          textSource = (this.activeSub && this.subsText && this.subsText[this.activeSub]) ? this.subsText[this.activeSub] : this.text;
          return this.ls(result, cx, ctx, partials, textSource.substring(start, end), tags);
        }
      }

      return result;
    }

    // method replace variable
    mv(func, ctx, partials) {
      const cx = ctx[ctx.length - 1];
      const result = func.call(cx);

      if (typeof result == 'function') {
        return this.ct(coerceToString(result.call(cx)), cx, partials);
      }

      return result;
    }

    sub(name, context, partials, indent) {
      const f = this.subs[name];
      if (f) {
        this.activeSub = name;
        f(context, partials, this, indent);
        this.activeSub = false;
      }
    }
  },

};
