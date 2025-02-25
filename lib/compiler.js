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
const rIsWhitespace = /\S/,
  rQuot = /\"/g,
  rNewline =  /\n/g,
  rCr = /\r/g,
  rSlash = /\\/g,
  rLineSep = /\u2028/,
  rParagraphSep = /\u2029/;

let serialNo = 0;

function cleanTripleStache(token) {
  if (token.n.substr(token.n.length - 1) === '}') {
    token.n = token.n.substring(0, token.n.length - 1);
  }
}

function trim(s) {
  if (s.trim) {
    return s.trim();
  }

  return s.replace(/^\s*|\s*$/g, '');
}

function tagChange(tag, text, index) {
  if (text.charAt(index) != tag.charAt(0)) {
    return false;
  }

  for (let i = 1, l = tag.length; i < l; i++) {
    if (text.charAt(index + i) != tag.charAt(i)) {
      return false;
    }
  }

  return true;
}

// the tags allowed inside super templates
const allowedInSuper = {'_t': true, '\n': true, '$': true, '/': true};

function buildTree(tokens, kind, stack, customTags) {
  let instructions = [],
    opener = null,
    tail = null,
    token = null;

  tail = stack[stack.length - 1];

  while (tokens.length > 0) {
    token = tokens.shift();

    if (tail && tail.tag == '<' && !(token.tag in allowedInSuper)) {
      throw new Error('Illegal content in < super tag.');
    }

    if (this.tags[token.tag] <= this.tags['$'] || isOpener(token, customTags)) {
      stack.push(token);
      token.nodes = buildTree(tokens, token.tag, stack, customTags);
    } else if (token.tag == '/') {
      if (stack.length === 0) {
        throw new Error('Closing tag without opener: /' + token.n);
      }
      opener = stack.pop();
      if (token.n != opener.n && !isCloser(token.n, opener.n, customTags)) {
        throw new Error('Nesting error: ' + opener.n + ' vs. ' + token.n);
      }
      opener.end = token.i;
      return instructions;
    } else if (token.tag == '\n') {
      token.last = (tokens.length == 0) || (tokens[0].tag == '\n');
    }

    instructions.push(token);
  }

  if (stack.length > 0) {
    throw new Error('missing closing tag: ' + stack.pop().n);
  }

  return instructions;
}

function isOpener(token, tags) {
  for (let i = 0, l = tags.length; i < l; i++) {
    if (tags[i].o == token.n) {
      token.tag = '#';
      return true;
    }
  }
}

function isCloser(close, open, tags) {
  for (let i = 0, l = tags.length; i < l; i++) {
    if (tags[i].c == close && tags[i].o == open) {
      return true;
    }
  }
}

function stringifySubstitutions(obj) {
  const items = [];
  for (let key in obj) {
    items.push('"' + esc(key) + '": function(c,p,t,i) {' + obj[key] + '}');
  }
  return "{ " + items.join(",") + " }";
}

function stringifyPartials(codeObj) {
  const partials = [];
  for (let key in codeObj.partials) {
    partials.push('"' + esc(key) + '":{name:"' + esc(codeObj.partials[key].name) + '", ' + stringifyPartials(codeObj.partials[key]) + "}");
  }
  return "partials: {" + partials.join(",") + "}, subs: " + stringifySubstitutions(codeObj.subs);
}

function esc(s) {
  return s.replace(rSlash, '\\\\')
    .replace(rQuot, '\\\"')
    .replace(rNewline, '\\n')
    .replace(rCr, '\\r')
    .replace(rLineSep, '\\u2028')
    .replace(rParagraphSep, '\\u2029');
}

function chooseMethod(s) {
  return (~s.indexOf('.')) ? 'd' : 'f';
}

function createPartial(node, context) {
  const prefix = "<" + (context.prefix || "");
  const sym = prefix + node.n + serialNo++;
  context.partials[sym] = {name: node.n, partials: {}};
  context.code += 't.b(t.rp("' +  esc(sym) + '",c,p,"' + (node.indent || '') + '"));';
  return sym;
}

function tripleStache(node, context) {
  context.code += 't.b(t.t(t.' + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,0)));';
}

function write(s) {
  return 't.b(' + s + ');';
}

const Hogan = {
  tags: {
    '#': 1, '^': 2, '<': 3, '$': 4,
    '/': 5, '!': 6, '>': 7, '=': 8, '_v': 9,
    '{': 10, '&': 11, '_t': 12
  },
  scan(text, delimiters){
    let len = text.length,
      IN_TEXT = 0,
      IN_TAG_TYPE = 1,
      IN_TAG = 2,
      state = IN_TEXT,
      tagType = null,
      tag = null,
      buf = '',
      tokens = [],
      seenTag = false,
      i = 0,
      lineStart = 0,
      otag = '{{',
      ctag = '}}';

    function addBuf() {
      if (buf.length > 0) {
        tokens.push({tag: '_t', text: new String(buf)});
        buf = '';
      }
    }

    function lineIsWhitespace() {
      let isAllWhitespace = true;
      for (let j = lineStart; j < tokens.length; j++) {
        isAllWhitespace =
          (Hogan.tags[tokens[j].tag] < Hogan.tags['_v']) ||
          (tokens[j].tag == '_t' && tokens[j].text.match(rIsWhitespace) === null);
        if (!isAllWhitespace) {
          return false;
        }
      }

      return isAllWhitespace;
    }

    function filterLine(haveSeenTag, noNewLine) {
      addBuf();

      if (haveSeenTag && lineIsWhitespace()) {
        for (let j = lineStart, next; j < tokens.length; j++) {
          if (tokens[j].text) {
            if ((next = tokens[j+1]) && next.tag == '>') {
              // set indent to token value
              next.indent = tokens[j].text.toString()
            }
            tokens.splice(j, 1);
          }
        }
      } else if (!noNewLine) {
        tokens.push({tag:'\n'});
      }

      seenTag = false;
      lineStart = tokens.length;
    }

    function changeDelimiters(text, index) {
      let close = '=' + ctag,
        closeIndex = text.indexOf(close, index),
        delimiters = trim(
          text.substring(text.indexOf('=', index) + 1, closeIndex)
        ).split(' ');

      otag = delimiters[0];
      ctag = delimiters[delimiters.length - 1];

      return closeIndex + close.length - 1;
    }

    if (delimiters) {
      delimiters = delimiters.split(' ');
      otag = delimiters[0];
      ctag = delimiters[1];
    }

    for (i = 0; i < len; i++) {
      if (state == IN_TEXT) {
        if (tagChange(otag, text, i)) {
          --i;
          addBuf();
          state = IN_TAG_TYPE;
        } else {
          if (text.charAt(i) == '\n') {
            filterLine(seenTag);
          } else {
            buf += text.charAt(i);
          }
        }
      } else if (state == IN_TAG_TYPE) {
        i += otag.length - 1;
        tag = Hogan.tags[text.charAt(i + 1)];
        tagType = tag ? text.charAt(i + 1) : '_v';
        if (tagType == '=') {
          i = changeDelimiters(text, i);
          state = IN_TEXT;
        } else {
          if (tag) {
            i++;
          }
          state = IN_TAG;
        }
        seenTag = i;
      } else {
        if (tagChange(ctag, text, i)) {
          tokens.push({tag: tagType, n: trim(buf), otag: otag, ctag: ctag,
            i: (tagType == '/') ? seenTag - otag.length : i + ctag.length});
          buf = '';
          i += ctag.length - 1;
          state = IN_TEXT;
          if (tagType == '{') {
            if (ctag == '}}') {
              i++;
            } else {
              cleanTripleStache(tokens[tokens.length - 1]);
            }
          }
        } else {
          buf += text.charAt(i);
        }
      }
    }

    filterLine(seenTag, true);

    return tokens;
  },
  stringify(codeObj, text, options) {
    return "{code: function (c,p,i) { " + Hogan.wrapMain(codeObj.code) + " }," + stringifyPartials(codeObj) +  "}";
  },
  generate(tree, text, options) {
    serialNo = 0;
    const context = { code: '', subs: {}, partials: {} };
    Hogan.walk(tree, context);

    if (options.asString) {
      return this.stringify(context, text, options);
    }

    return this.makeTemplate(context, text, options);
  },
  wrapMain(code) {
    return 'var t=this;t.b(i=i||"");' + code + 'return t.fl();';
  },
  template(){
    return this.Template.apply(this, arguments);
  },
  makeTemplate(codeObj, text, options) {
    const template = this.makePartials(codeObj);
    template.code = new Function('c', 'p', 'i', this.wrapMain(codeObj.code));
    return new this.template(template, text, this, options);
  },
  makePartials(codeObj) {
    let key, template = {subs: {}, partials: codeObj.partials, name: codeObj.name};
    for (key in template.partials) {
      template.partials[key] = this.makePartials(template.partials[key]);
    }
    for (key in codeObj.subs) {
      template.subs[key] = new Function('c', 'p', 't', 'i', codeObj.subs[key]);
    }
    return template;
  },
  walk(nodelist, context) {
    let func;
    for (let i = 0, l = nodelist.length; i < l; i++) {
      func = Hogan.codegen[nodelist[i].tag];
      func && func(nodelist[i], context);
    }
    return context;
  },
  parse(tokens, text, options) {
    options = options || {};
    return buildTree(tokens, '', [], options.sectionTags || []);
  },
  cacheKey(text, options) {
    return [text, !!options.asString, !!options.disableLambda, options.delimiters, !!options.modelGet].join('||');
  },
  compile(text, options) {
    options = options || {};
    let key = Hogan.cacheKey(text, options);
    let template = this.cache[key];

    if (template) {
      let partials = template.partials;
      for (let name in partials) {
        delete partials[name].instance;
      }
      return template;
    }

    template = this.generate(this.parse(this.scan(text, options.delimiters), text, options), text, options);
    return this.cache[key] = template;
  }
}

Hogan.codegen = {
  '#': function(node, context) {
    context.code += 'if(t.s(t.' + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,1),' +
      'c,p,0,' + node.i + ',' + node.end + ',"' + node.otag + " " + node.ctag + '")){' +
      't.rs(c,p,' + 'function(c,p,t){';
    Hogan.walk(node.nodes, context);
    context.code += '});c.pop();}';
  },

  '^': function(node, context) {
    context.code += 'if(!t.s(t.' + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,1),c,p,1,0,0,"")){';
    Hogan.walk(node.nodes, context);
    context.code += '};';
  },

  '>': createPartial,
    '<': function(node, context) {
    const ctx = {partials: {}, code: '', subs: {}, inPartial: true};
    Hogan.walk(node.nodes, ctx);
    const template = context.partials[createPartial(node, context)];
    template.subs = ctx.subs;
    template.partials = ctx.partials;
  },

  '$': function(node, context) {
    const ctx = {subs: {}, code: '', partials: context.partials, prefix: node.n};
    Hogan.walk(node.nodes, ctx);
    context.subs[node.n] = ctx.code;
    if (!context.inPartial) {
      context.code += 't.sub("' + esc(node.n) + '",c,p,i);';
    }
  },

  '\n': function(node, context) {
    context.code += write('"\\n"' + (node.last ? '' : ' + i'));
  },

  '_v': function(node, context) {
    context.code += 't.b(t.v(t.' + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,0)));';
  },

  '_t': function(node, context) {
    context.code += write('"' + esc(node.text) + '"');
  },

  '{': tripleStache,

    '&': tripleStache
};

export default Hogan
