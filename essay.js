/* Turns a journal entry's Markdown into page elements. Markdown is plain text with marks
   such as ## for a heading. Tags in that text stay text. They are not HTML.
   A code block is lines wrapped in ``` marks. The word on the opening line,
   such as python, says which language it is. The editor and the journal page
   split that block into colored pieces. The colors are in style.css and
   follow the light or dark appearance.
   On the journal page each source line has a line number. A source line is one
   line as written, before the browser folds it to fit the screen. The number
   stays on the first row of that line, so a fold pushes the next number down.
   The editor does not add numbers: the caret and the saved text stay the code. */
(function (root) {
  var MAX = 200000;

  function safeUrl(value) {
    if (value == null) return null;
    var url = String(value).replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!url || url.length > 2000) return null;
    if (/[<>"'\\\s]/.test(url)) return null;
    if (url.indexOf("//") === 0) return null;
    var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
    if (scheme) {
      var name = scheme[1].toLowerCase();
      if (name !== "http" && name !== "https" && name !== "mailto") return null;
      return url;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
    return url;
  }

  function clear(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function findCloser(text, from, marker) {
    var i = from;
    while (i < text.length) {
      if (text.charAt(i) === "\\") {
        i += 2;
        continue;
      }
      if (text.charAt(i) === "`") {
        var run = 1;
        while (text.charAt(i + run) === "`") run += 1;
        var marker = "";
        for (var tick = 0; tick < run; tick += 1) marker += "`";
        var closeTick = text.indexOf(marker, i + run);
        if (closeTick === -1) return -1;
        i = closeTick + run;
        continue;
      }
      if (marker === "*" && text.substr(i, 2) === "**") {
        i += 2;
        continue;
      }
      if (text.substr(i, marker.length) === marker) return i;
      i += 1;
    }
    return -1;
  }

  function parseLink(text, start) {
    var j = start + 1;
    var labelEnd = -1;
    while (j < text.length) {
      if (text.charAt(j) === "\\") {
        j += 2;
        continue;
      }
      if (text.charAt(j) === "]") {
        labelEnd = j;
        break;
      }
      j += 1;
    }
    if (labelEnd < 0 || text.charAt(labelEnd + 1) !== "(") return null;
    var urlEnd = text.indexOf(")", labelEnd + 2);
    if (urlEnd < 0) return null;
    var label = text.slice(start + 1, labelEnd);
    var url = text.slice(labelEnd + 2, urlEnd).trim();
    if (!label || !url || /\s/.test(url)) return null;
    return { label: label, url: url, end: urlEnd + 1 };
  }

  function appendInlines(parent, text) {
    var i = 0;
    var plain = "";
    function flush() {
      if (!plain) return;
      parent.appendChild(document.createTextNode(plain));
      plain = "";
    }
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === "\n") {
        flush();
        parent.appendChild(document.createElement("br"));
        i += 1;
        continue;
      }
      if (ch === "\\" && i + 1 < text.length) {
        plain += text.charAt(i + 1);
        i += 2;
        continue;
      }
      if (ch === "`") {
        var run = 1;
        while (text.charAt(i + run) === "`") run += 1;
        var marker = "";
        for (var tick = 0; tick < run; tick += 1) marker += "`";
        var closeTick = text.indexOf(marker, i + run);
        if (closeTick > i + run) {
          flush();
          var raw = text.slice(i + run, closeTick);
          if (run > 1) raw = raw.replace(/^ /, "").replace(/ $/, "");
          var code = document.createElement("code");
          code.textContent = raw;
          parent.appendChild(code);
          i = closeTick + run;
          continue;
        }
      }
      if (text.substr(i, 2) === "**") {
        var boldEnd = findCloser(text, i + 2, "**");
        if (boldEnd > i + 2) {
          flush();
          var strong = document.createElement("strong");
          appendInlines(strong, text.slice(i + 2, boldEnd));
          parent.appendChild(strong);
          i = boldEnd + 2;
          continue;
        }
      }
      if (ch === "*") {
        var emEnd = findCloser(text, i + 1, "*");
        if (emEnd > i + 1) {
          flush();
          var em = document.createElement("em");
          appendInlines(em, text.slice(i + 1, emEnd));
          parent.appendChild(em);
          i = emEnd + 1;
          continue;
        }
      }
      if (ch === "[") {
        var link = parseLink(text, i);
        if (link) {
          flush();
          var href = safeUrl(link.url);
          if (href) {
            var anchor = document.createElement("a");
            anchor.setAttribute("href", href);
            appendInlines(anchor, link.label);
            parent.appendChild(anchor);
          } else {
            appendInlines(parent, link.label);
          }
          i = link.end;
          continue;
        }
      }
      plain += ch;
      i += 1;
    }
    flush();
  }

  function isFence(line) {
    return /^(```+)[^`]*$/.exec(line);
  }

  function isRule(line) {
    return /^(\-{3,}|\*{3,}|_{3,})\s*$/.test(line);
  }

  function isHeading(line) {
    return /^(#{1,6})\s+(\S.*)$/.exec(line);
  }

  function isBullet(line) {
    return /^[-*]\s+\S/.test(line);
  }

  function isNumber(line) {
    return /^\d+[.)]\s+\S/.test(line);
  }

  function isQuote(line) {
    return /^>\s?/.test(line);
  }

  function isBlockStart(line) {
    return isFence(line) || isRule(line) || isHeading(line) || isBullet(line) || isNumber(line) || isQuote(line);
  }

  function addParagraph(container, text) {
    var paragraph = document.createElement("p");
    appendInlines(paragraph, text);
    container.appendChild(paragraph);
  }

  function addList(container, lines, index, ordered) {
    var list = document.createElement(ordered ? "ol" : "ul");
    var pattern = ordered ? /^(\d+)[.)]\s+(.*)$/ : /^[-*]\s+(.*)$/;
    var first = true;
    while (index < lines.length) {
      var line = lines[index];
      var match = pattern.exec(line);
      if (match) {
        if (first && ordered) {
          var start = parseInt(match[1], 10);
          if (start > 1 && start < 10000) list.setAttribute("start", String(start));
        }
        first = false;
        var item = document.createElement("li");
        appendInlines(item, ordered ? match[2] : match[1]);
        list.appendChild(item);
        index += 1;
        continue;
      }
      if (list.lastChild && /^\s+\S/.test(line) && !isBlockStart(line.replace(/^\s+/, ""))) {
        list.lastChild.appendChild(document.createElement("br"));
        appendInlines(list.lastChild, line.trim());
        index += 1;
        continue;
      }
      break;
    }
    container.appendChild(list);
    return index;
  }

  var ALIAS = {
    py: "python",
    js: "javascript",
    jsx: "javascript",
    node: "javascript",
    ts: "typescript",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    rb: "ruby",
    rs: "rust",
    h: "c",
    hpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    "c++": "cpp",
    "c#": "csharp"
  };

  var FAMILY = {
    python: "python",
    javascript: "javascript",
    typescript: "javascript",
    html: "html",
    xml: "html",
    svg: "html",
    css: "css",
    json: "json",
    shell: "shell",
    sql: "sql",
    c: "c",
    cpp: "c",
    java: "c",
    go: "c",
    rust: "c",
    csharp: "c",
    ruby: "ruby"
  };

  var OPS = /^(?:===|!==|==|!=|<=|>=|&&|\|\||=>|\+\+|--|<<|>>|\+=|-=|\*=|\/=|%=|\*\*|\/\/|:=|->|[+\-*/%=<>!&|^~?:])/;
  var PUNCT = /^[()[\]{}.,;]/;
  var TOKEN_KINDS = {
    comment: 1, string: 1, keyword: 1, number: 1, function: 1, type: 1,
    builtin: 1, property: 1, attr: 1, tag: 1, operator: 1, punct: 1, variable: 1
  };
  var templateDepth = 0;

  function codeLanguage(raw) {
    var match = /^[A-Za-z0-9_+#.-]+/.exec(String(raw || "").trim());
    var name = match ? match[0].toLowerCase().slice(0, 20) : "";
    if (!name || name === "text" || name === "plain" || name === "plaintext" || name === "txt") {
      return { label: "", family: "" };
    }
    var label = Object.prototype.hasOwnProperty.call(ALIAS, name) ? ALIAS[name] : name;
    var family = "";
    if (Object.prototype.hasOwnProperty.call(FAMILY, label)) family = FAMILY[label];
    else if (Object.prototype.hasOwnProperty.call(FAMILY, name)) family = FAMILY[name];
    else family = "generic";
    return { label: label, family: family };
  }

  function token(kind, text) {
    return [{ kind: kind, text: text }];
  }

  function emitInto(out, parts) {
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part.text) continue;
      var last = out[out.length - 1];
      if (last && last.kind === part.kind) last.text += part.text;
      else out.push({ kind: part.kind, text: part.text });
    }
  }

  function scan(text, rules) {
    var out = [];
    var plain = "";
    var i = 0;
    function flush() {
      if (!plain) return;
      emitInto(out, [{ kind: "", text: plain }]);
      plain = "";
    }
    while (i < text.length) {
      var found = null;
      for (var r = 0; r < rules.length; r++) {
        found = rules[r](text, i);
        if (found && found.length) break;
        found = null;
      }
      if (!found) {
        plain += text.charAt(i);
        i += 1;
        continue;
      }
      var size = 0;
      for (var n = 0; n < found.length; n++) size += found[n].text.length;
      if (size < 1) {
        plain += text.charAt(i);
        i += 1;
        continue;
      }
      flush();
      emitInto(out, found);
      i += size;
    }
    flush();
    return out;
  }

  function wordRule(words, kind, insensitive) {
    var sorted = words.slice().sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp("^(?:" + sorted.join("|") + ")\\b", insensitive ? "i" : "");
    return function (text, i) {
      if (i > 0 && text.charAt(i - 1) === ".") return null;
      var match = re.exec(text.slice(i));
      return match ? token(kind, match[0]) : null;
    };
  }

  function declared(keyword, nameKind) {
    var re = new RegExp("^(" + keyword + ")(\\s+)([A-Za-z_]\\w*)");
    return function (text, i) {
      if (i > 0 && /[\w.]/.test(text.charAt(i - 1))) return null;
      var match = re.exec(text.slice(i));
      if (!match) return null;
      return [
        { kind: "keyword", text: match[1] },
        { kind: "", text: match[2] },
        { kind: nameKind, text: match[3] }
      ];
    };
  }

  function propertyAt(text, i) {
    if (i === 0 || text.charAt(i - 1) !== ".") return null;
    var match = /^[A-Za-z_]\w*/.exec(text.slice(i));
    return match ? token("property", match[0]) : null;
  }

  function functionAt(text, i) {
    if (i > 0 && text.charAt(i - 1) === ".") return null;
    var match = /^[A-Za-z_]\w*(?=\s*\()/.exec(text.slice(i));
    return match ? token("function", match[0]) : null;
  }

  function numberAt(text, i) {
    if (i > 0 && /[A-Za-z0-9_]/.test(text.charAt(i - 1))) return null;
    var match = /^(?:0[xX][0-9A-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?|\.\d[\d_]*(?:[eE][+-]?\d[\d_]*)?)/.exec(text.slice(i));
    return match ? token("number", match[0]) : null;
  }

  function hashComment(always) {
    return function (text, i) {
      if (text.charAt(i) !== "#") return null;
      if (!always && i > 0 && !/\s/.test(text.charAt(i - 1))) return null;
      var end = text.indexOf("\n", i);
      if (end < 0) end = text.length;
      return token("comment", text.slice(i, end));
    };
  }

  function lineComment(text, i) {
    if (text.substr(i, 2) !== "//") return null;
    if (i > 0 && text.charAt(i - 1) === ":") return null;
    var end = text.indexOf("\n", i);
    if (end < 0) end = text.length;
    return token("comment", text.slice(i, end));
  }

  function blockComment(text, i) {
    if (text.substr(i, 2) !== "/*") return null;
    var end = text.indexOf("*/", i + 2);
    var stop = end === -1 ? text.length : end + 2;
    return token("comment", text.slice(i, stop));
  }

  function ellipsisAt(text, i) {
    if (text.substr(i, 3) !== "...") return null;
    return token("punct", "...");
  }

  function opAt(text, i) {
    var match = OPS.exec(text.slice(i));
    return match ? token("operator", match[0]) : null;
  }

  function punctAt(text, i) {
    var match = PUNCT.exec(text.slice(i));
    return match ? token("punct", match[0]) : null;
  }

  function decoratorAt(text, i) {
    var match = /^@[A-Za-z_][\w.]*/.exec(text.slice(i));
    return match ? token("keyword", match[0]) : null;
  }

  function pythonPrefixOk(prefix) {
    if (!prefix) return true;
    var f = 0;
    var r = 0;
    var b = 0;
    var u = 0;
    for (var k = 0; k < prefix.length; k++) {
      var ch = prefix.charAt(k).toLowerCase();
      if (ch === "f") f += 1;
      else if (ch === "r") r += 1;
      else if (ch === "b") b += 1;
      else if (ch === "u") u += 1;
      else return false;
    }
    if (f > 1 || r > 1 || b > 1 || u > 1) return false;
    if (u && (b || f)) return false;
    if (b && f) return false;
    return true;
  }

  function readQuoted(text, start, quoteAt, quote) {
    var triple = text.substr(quoteAt, 3) === quote + quote + quote;
    var i = quoteAt + (triple ? 3 : 1);
    var endMark = triple ? quote + quote + quote : quote;
    while (i < text.length) {
      if (text.charAt(i) === "\\") {
        i += 2;
        continue;
      }
      if (!triple && text.charAt(i) === "\n") return text.slice(start, i);
      if (text.substr(i, endMark.length) === endMark) return text.slice(start, i + endMark.length);
      i += 1;
    }
    return text.slice(start, text.length);
  }

  function pythonStringAt(text, i) {
    var max = Math.min(text.length, i + 2);
    var j = i;
    while (j < max && /[rRuUbBfF]/.test(text.charAt(j))) j += 1;
    for (var p = j; p >= i; p--) {
      if (p >= text.length) continue;
      var quote = text.charAt(p);
      if (quote !== "'" && quote !== '"') continue;
      var prefix = text.slice(i, p);
      if (!pythonPrefixOk(prefix)) continue;
      return token("string", readQuoted(text, i, p, quote));
    }
    return null;
  }

  function readTemplate(text, i) {
    if (templateDepth > 6) return token("string", text.slice(i));
    var out = [];
    var j = i + 1;
    var chunk = "`";
    templateDepth += 1;
    while (j < text.length) {
      var ch = text.charAt(j);
      if (ch === "\\") {
        chunk += text.substr(j, 2);
        j += text.charAt(j + 1) ? 2 : 1;
        continue;
      }
      if (text.substr(j, 2) === "${") {
        chunk += "${";
        out.push({ kind: "string", text: chunk });
        j += 2;
        var depth = 1;
        var expr = "";
        while (j < text.length && depth > 0) {
          var inner = text.charAt(j);
          if (inner === "{") depth += 1;
          else if (inner === "}") {
            depth -= 1;
            if (depth === 0) break;
          }
          expr += inner;
          j += 1;
        }
        emitInto(out, tokenizeFamily(expr, "javascript"));
        chunk = "";
        if (depth === 0 && text.charAt(j) === "}") {
          chunk = "}";
          j += 1;
        }
        continue;
      }
      chunk += ch;
      j += 1;
      if (ch === "`") {
        out.push({ kind: "string", text: chunk });
        templateDepth -= 1;
        return out;
      }
    }
    if (chunk) out.push({ kind: "string", text: chunk });
    templateDepth -= 1;
    return out;
  }

  function jsStringAt(text, i) {
    var quote = text.charAt(i);
    if (quote !== "'" && quote !== '"' && quote !== "`") return null;
    if (quote === "`") return readTemplate(text, i);
    var j = i + 1;
    while (j < text.length) {
      if (text.charAt(j) === "\\") {
        j += 2;
        continue;
      }
      if (text.charAt(j) === "\n") return token("string", text.slice(i, j));
      if (text.charAt(j) === quote) return token("string", text.slice(i, j + 1));
      j += 1;
    }
    return token("string", text.slice(i, j));
  }

  function shellStringAt(text, i) {
    var quote = text.charAt(i);
    if (quote !== "'" && quote !== '"') return null;
    var j = i + 1;
    while (j < text.length) {
      if (quote === '"' && text.charAt(j) === "\\") {
        j += 2;
        continue;
      }
      if (text.charAt(j) === quote) return token("string", text.slice(i, j + 1));
      j += 1;
    }
    return token("string", text.slice(i, j));
  }

  function sqlStringAt(text, i) {
    var quote = text.charAt(i);
    if (quote !== "'" && quote !== '"') return null;
    var j = i + 1;
    while (j < text.length) {
      if (text.charAt(j) === quote && text.charAt(j + 1) === quote) {
        j += 2;
        continue;
      }
      if (text.charAt(j) === quote) return token("string", text.slice(i, j + 1));
      j += 1;
    }
    return token("string", text.slice(i, j));
  }

  function shellVarAt(text, i) {
    if (text.charAt(i) !== "$") return null;
    var match = /^\$\{[^}\n]*\}|^\$[A-Za-z_][\w]*|^\$[0-9#@*?!$]/.exec(text.slice(i));
    return match ? token("variable", match[0]) : null;
  }

  function cssStringAt(text, i) {
    return shellStringAt(text, i);
  }

  function cssColorAt(text, i) {
    var match = /^#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})\b/.exec(text.slice(i));
    return match ? token("number", match[0]) : null;
  }

  function cssNumberAt(text, i) {
    if (i > 0 && /[\w-]/.test(text.charAt(i - 1))) return null;
    var match = /^(?:\d*\.\d+|\d+)(?:%|px|rem|em|vh|vw|ch|ex|s|ms)?/.exec(text.slice(i));
    if (!match || !/\d/.test(match[0])) return null;
    return token("number", match[0]);
  }

  function cssPropertyAt(text, i) {
    if (i > 0 && /[\w-]/.test(text.charAt(i - 1))) return null;
    var match = /^(-{0,2}[A-Za-z_][\w-]*)(\s*)(:)/.exec(text.slice(i));
    if (!match) return null;
    return [
      { kind: "property", text: match[1] },
      { kind: "", text: match[2] },
      { kind: "punct", text: match[3] }
    ];
  }

  function cssAtRule(text, i) {
    var match = /^@[A-Za-z_-]+/.exec(text.slice(i));
    return match ? token("keyword", match[0]) : null;
  }

  function cssImportant(text, i) {
    if (text.substr(i, 10).toLowerCase() !== "!important") return null;
    if (i + 10 < text.length && /[\w]/.test(text.charAt(i + 10))) return null;
    return token("keyword", text.slice(i, i + 10));
  }

  function sqlCommentAt(text, i) {
    if (text.substr(i, 2) === "--") {
      var end = text.indexOf("\n", i);
      if (end < 0) end = text.length;
      return token("comment", text.slice(i, end));
    }
    return blockComment(text, i);
  }

  var PY_KEYWORDS = ["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "match", "case"];
  var PY_BUILTINS = ["print", "len", "range", "str", "int", "float", "list", "dict", "set", "tuple", "type", "open", "enumerate", "zip", "map", "filter", "sum", "min", "max", "abs", "any", "all", "sorted", "reversed", "isinstance", "issubclass", "super", "object", "bool", "bytes", "property"];
  var JS_KEYWORDS = ["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "false", "finally", "for", "from", "function", "if", "import", "in", "instanceof", "let", "new", "null", "of", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "undefined", "var", "void", "while", "with", "yield", "async", "await"];
  var TS_KEYWORDS = JS_KEYWORDS.concat(["interface", "type", "public", "private", "protected", "implements", "readonly", "enum", "namespace", "declare", "keyof", "infer", "abstract", "override", "satisfies"]);
  var JS_BUILTINS = ["console", "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Promise", "Date", "Map", "Set", "Symbol", "Error", "RegExp", "parseInt", "parseFloat", "isNaN", "document", "window"];
  var C_KEYWORDS = ["break", "case", "catch", "class", "const", "continue", "default", "do", "else", "enum", "export", "extends", "final", "finally", "for", "from", "func", "function", "goto", "if", "implements", "import", "in", "interface", "let", "namespace", "new", "nil", "null", "package", "private", "protected", "public", "return", "sizeof", "static", "struct", "switch", "this", "throw", "try", "typedef", "typeof", "using", "var", "while", "yield", "async", "await", "fn", "mut", "pub", "crate", "dyn", "where", "move", "ref", "defer", "go", "chan", "map", "range", "select", "type"];
  var C_TYPES = ["int", "long", "short", "char", "void", "bool", "float", "double", "signed", "unsigned", "size_t", "int32_t", "int64_t", "uint32_t", "uint64_t", "string", "auto", "boolean", "byte"];
  var RUBY_KEYWORDS = ["def", "end", "class", "module", "if", "else", "elsif", "unless", "while", "until", "for", "do", "begin", "rescue", "ensure", "case", "when", "then", "yield", "return", "self", "nil", "true", "false", "and", "or", "not", "in", "super"];
  var RUBY_BUILTINS = ["require", "include", "extend", "puts", "print", "attr_reader", "attr_writer", "attr_accessor"];
  var SQL_KEYWORDS = ["select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set", "delete", "create", "table", "drop", "alter", "join", "left", "right", "inner", "outer", "full", "on", "as", "group", "by", "order", "having", "limit", "offset", "distinct", "union", "all", "in", "is", "null", "like", "between", "exists", "case", "when", "then", "else", "end", "primary", "key", "foreign", "references", "index", "view", "with", "recursive", "true", "false", "begin", "commit", "rollback", "asc", "desc"];
  var SQL_BUILTINS = ["count", "sum", "avg", "min", "max"];
  var SH_KEYWORDS = ["if", "then", "else", "elif", "fi", "for", "do", "done", "in", "case", "esac", "while", "until", "function", "select", "time"];
  var SH_BUILTINS = ["echo", "printf", "cd", "export", "local", "return", "exit", "read", "set", "unset", "alias", "source", "eval", "test", "shift", "trap", "pwd"];

  function baseRules(keywords, builtins, types, insensitive) {
    var rules = [numberAt, propertyAt];
    if (keywords && keywords.length) rules.push(wordRule(keywords, "keyword", insensitive));
    if (types && types.length) rules.push(wordRule(types, "type", insensitive));
    if (builtins && builtins.length) rules.push(wordRule(builtins, "builtin", insensitive));
    rules.push(functionAt, ellipsisAt, opAt, punctAt);
    return rules;
  }

  function preprocAt(text, i) {
    if (text.charAt(i) !== "#") return null;
    var lineStart = text.lastIndexOf("\n", i - 1) + 1;
    if (!/^[ \t]*$/.test(text.slice(lineStart, i))) return null;
    var match = /^#[ \t]*[A-Za-z_]\w*/.exec(text.slice(i));
    return match ? token("keyword", match[0]) : null;
  }

  var RULES = {
    python: [hashComment(true), pythonStringAt, decoratorAt, declared("def", "function"), declared("class", "type")].concat(baseRules(PY_KEYWORDS, PY_BUILTINS)),
    javascript: [blockComment, lineComment, jsStringAt, declared("function", "function"), declared("class", "type")].concat(baseRules(JS_KEYWORDS, JS_BUILTINS)),
    ruby: [hashComment(true), jsStringAt, declared("def", "function"), declared("class", "type"), declared("module", "type")].concat(baseRules(RUBY_KEYWORDS, RUBY_BUILTINS)),
    c: [blockComment, lineComment, preprocAt, jsStringAt].concat(baseRules(C_KEYWORDS, [], C_TYPES)),
    shell: [hashComment(false), shellStringAt, shellVarAt].concat(baseRules(SH_KEYWORDS, SH_BUILTINS)),
    sql: [sqlCommentAt, sqlStringAt].concat(baseRules(SQL_KEYWORDS, SQL_BUILTINS, [], true)),
    generic: [blockComment, lineComment, hashComment(true), jsStringAt, numberAt, ellipsisAt, opAt, punctAt]
  };

  function cssRules() {
    var depth = 0;
    function property(text, i) {
      if (depth < 1) return null;
      return cssPropertyAt(text, i);
    }
    function braces(text, i) {
      var ch = text.charAt(i);
      if (ch !== "{" && ch !== "}") return null;
      if (ch === "{") depth += 1;
      else if (depth > 0) depth -= 1;
      return token("punct", ch);
    }
    return [blockComment, cssStringAt, cssImportant, cssAtRule, cssColorAt, cssNumberAt, property, functionAt, ellipsisAt, opAt, braces, punctAt];
  }

  function tokenizeHtml(text) {
    var out = [];
    var i = 0;
    function push(kind, slice) {
      if (!slice) return;
      var last = out[out.length - 1];
      if (last && last.kind === kind) last.text += slice;
      else out.push({ kind: kind, text: slice });
    }
    while (i < text.length) {
      if (text.substr(i, 4) === "<!--") {
        var close = text.indexOf("-->", i + 4);
        var stop = close === -1 ? text.length : close + 3;
        push("comment", text.slice(i, stop));
        i = stop;
        continue;
      }
      if (text.substr(i, 2) === "<!" || /^<\?/i.test(text.slice(i, i + 2))) {
        var endDecl = text.indexOf(">", i);
        var declStop = endDecl === -1 ? text.length : endDecl + 1;
        push("keyword", text.slice(i, declStop));
        i = declStop;
        continue;
      }
      if (text.charAt(i) === "<") {
        push("punct", "<");
        i += 1;
        if (text.charAt(i) === "/") {
          push("punct", "/");
          i += 1;
        }
        var name = /^[A-Za-z][\w:-]*/.exec(text.slice(i));
        if (name) {
          push("tag", name[0]);
          i += name[0].length;
        }
        while (i < text.length && text.charAt(i) !== ">") {
          if (text.substr(i, 2) === "/>") break;
          if (/\s/.test(text.charAt(i))) {
            var space = /^\s+/.exec(text.slice(i));
            push("", space[0]);
            i += space[0].length;
            continue;
          }
          var attr = /^[A-Za-z_:][\w:.-]*/.exec(text.slice(i));
          if (attr) {
            push("attr", attr[0]);
            i += attr[0].length;
            continue;
          }
          if (text.charAt(i) === "=") {
            push("operator", "=");
            i += 1;
            continue;
          }
          if (text.charAt(i) === '"' || text.charAt(i) === "'") {
            var quote = text.charAt(i);
            var j = i + 1;
            while (j < text.length && text.charAt(j) !== quote) {
              if (text.charAt(j) === "\\") j += 2;
              else j += 1;
            }
            if (j < text.length) j += 1;
            push("string", text.slice(i, j));
            i = j;
            continue;
          }
          push("", text.charAt(i));
          i += 1;
        }
        if (text.substr(i, 2) === "/>") {
          push("punct", "/>");
          i += 2;
        } else if (text.charAt(i) === ">") {
          push("punct", ">");
          i += 1;
        }
        continue;
      }
      push("", text.charAt(i));
      i += 1;
    }
    return out;
  }

  function tokenizeJson(text) {
    var out = [];
    var i = 0;
    function push(kind, slice) {
      if (!slice) return;
      var last = out[out.length - 1];
      if (last && last.kind === kind) last.text += slice;
      else out.push({ kind: kind, text: slice });
    }
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === '"') {
        var j = i + 1;
        while (j < text.length) {
          if (text.charAt(j) === "\\") {
            j += 2;
            continue;
          }
          if (text.charAt(j) === '"') {
            j += 1;
            break;
          }
          j += 1;
        }
        var k = j;
        while (k < text.length && /\s/.test(text.charAt(k))) k += 1;
        push(text.charAt(k) === ":" ? "property" : "string", text.slice(i, j));
        i = j;
        continue;
      }
      if (ch === "-" || (ch >= "0" && ch <= "9")) {
        var num = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
        if (num) {
          push("number", num[0]);
          i += num[0].length;
          continue;
        }
      }
      var word = /^(?:true|false|null)\b/.exec(text.slice(i));
      if (word) {
        push("keyword", word[0]);
        i += word[0].length;
        continue;
      }
      if ("{}[],:".indexOf(ch) !== -1) {
        push("punct", ch);
        i += 1;
        continue;
      }
      push("", ch);
      i += 1;
    }
    return out;
  }

  function tokenizeFamily(text, family) {
    if (!text) return [];
    if (family === "html") return tokenizeHtml(text);
    if (family === "json") return tokenizeJson(text);
    if (family === "css") return scan(text, cssRules());
    if (family === "javascript") return scan(text, RULES.javascript);
    var rules = RULES[family] || RULES.generic;
    return scan(text, rules);
  }

  function tokenize(text, lang) {
    var described = codeLanguage(lang);
    var source = String(text || "");
    if (!described.family) return source ? [{ kind: "", text: source }] : [];
    if (described.family === "javascript" && described.label === "typescript") {
      var rules = [blockComment, lineComment, jsStringAt, declared("function", "function"), declared("class", "type"), declared("interface", "type")].concat(baseRules(TS_KEYWORDS, JS_BUILTINS));
      return scan(source, rules);
    }
    return tokenizeFamily(source, described.family);
  }

  function appendPiece(parent, kind, text) {
    if (!text) return;
    if (!kind || !TOKEN_KINDS[kind]) {
      parent.appendChild(document.createTextNode(text));
      return;
    }
    var span = document.createElement("span");
    span.className = "tok-" + kind;
    span.textContent = text;
    parent.appendChild(span);
  }

  function piecesByLine(source, lang) {
    var described = codeLanguage(lang);
    var parts = [];
    if (!described.family) {
      if (source) parts = [{ kind: "", text: source }];
    } else if (source) {
      parts = tokenize(source, described.label);
    }
    var lines = [[]];
    for (var i = 0; i < parts.length; i++) {
      var chunks = String(parts[i].text || "").split("\n");
      for (var c = 0; c < chunks.length; c++) {
        if (c > 0) lines.push([]);
        if (chunks[c]) lines[lines.length - 1].push({ kind: parts[i].kind || "", text: chunks[c] });
      }
    }
    return lines;
  }

  function paintFlat(code, source, lang) {
    var described = codeLanguage(lang);
    if (!described.family) {
      if (source) code.appendChild(document.createTextNode(source));
      else code.appendChild(document.createElement("br"));
      return;
    }
    var parts = tokenize(source, described.label);
    for (var i = 0; i < parts.length; i++) appendPiece(code, parts[i].kind, parts[i].text);
    if (!code.firstChild) code.appendChild(document.createElement("br"));
  }

  function paintLines(code, source, lang) {
    var lines = piecesByLine(source, lang);
    var host = code.parentNode && code.parentNode.nodeType === 1 ? code.parentNode : code;
    host.style.setProperty("--line-digits", String(String(lines.length).length));
    code.classList.add("lined");
    for (var i = 0; i < lines.length; i++) {
      var line = document.createElement("span");
      line.className = "line";
      var src = document.createElement("span");
      src.className = "src";
      var pieces = lines[i];
      for (var p = 0; p < pieces.length; p++) appendPiece(src, pieces[p].kind, pieces[p].text);
      line.appendChild(src);
      code.appendChild(line);
      if (i < lines.length - 1) {
        var nl = document.createElement("span");
        nl.className = "nl";
        nl.textContent = "\n";
        code.appendChild(nl);
      }
    }
  }

  function paint(code, text, lang, lined) {
    while (code.firstChild) code.removeChild(code.firstChild);
    code.classList.remove("lined");
    var host = code.parentNode && code.parentNode.nodeType === 1 ? code.parentNode : null;
    if (host && host.style) host.style.removeProperty("--line-digits");
    var source = String(text || "");
    if (lined) paintLines(code, source, lang);
    else paintFlat(code, source, lang);
  }

  function fenceAround(markdown, pos) {
    var text = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var lines = text.split("\n");
    var offset = 0;
    var open = null;
    var cursor = pos == null ? 0 : pos;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lineStart = offset;
      var lineEnd = offset + line.length;
      var ticks = /^(```+)/.exec(line);
      if (open && ticks && new RegExp("^`{" + open.size + ",}\\s*$").test(line)) {
        if (cursor >= open.lineStart && cursor <= lineEnd) return open;
        open = null;
      } else if (!open && ticks && /^(```+)[^`]*$/.test(line)) {
        open = {
          size: ticks[1].length,
          ticks: ticks[1],
          lineStart: lineStart,
          lineEnd: lineEnd,
          lang: codeLanguage(line.slice(ticks[1].length)).label
        };
      }
      offset = lineEnd + 1;
    }
    if (open && cursor >= open.lineStart) return open;
    return null;
  }

  function editingHost(container) {
    if (!container || !container.closest) return false;
    if (container.getAttribute && container.getAttribute("contenteditable") === "true") return true;
    return !!container.closest("[contenteditable='true']");
  }

  function renderBlocks(markdown, container, lined) {
    var lines = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var index = 0;
    while (index < lines.length) {
      var line = lines[index];
      if (line.trim() === "") {
        index += 1;
        continue;
      }
      var fence = isFence(line);
      if (fence) {
        var size = fence[1].length;
        var info = line.slice(size).trim().split(/\s+/)[0] || "";
        var described = codeLanguage(info);
        index += 1;
        var body = [];
        var closeFence = new RegExp("^`{" + size + ",}\\s*$");
        while (index < lines.length && !closeFence.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        var pre = document.createElement("pre");
        pre.setAttribute("spellcheck", "false");
        if (described.label) pre.setAttribute("data-lang", described.label);
        var code = document.createElement("code");
        pre.appendChild(code);
        paint(code, body.join("\n"), described.label, lined);
        container.appendChild(pre);
        continue;
      }
      if (isRule(line)) {
        container.appendChild(document.createElement("hr"));
        index += 1;
        continue;
      }
      var heading = isHeading(line);
      if (heading) {
        var level = heading[1].length;
        var title = document.createElement(level <= 2 ? "h2" : "h3");
        appendInlines(title, heading[2].trim());
        container.appendChild(title);
        index += 1;
        continue;
      }
      if (isQuote(line)) {
        var quote = document.createElement("blockquote");
        var quoted = [];
        while (index < lines.length && isQuote(lines[index])) {
          quoted.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        var chunk = [];
        function flushQuote() {
          if (!chunk.length) return;
          addParagraph(quote, chunk.join(" "));
          chunk = [];
        }
        quoted.forEach(function (part) {
          if (part.trim() === "") flushQuote();
          else chunk.push(part);
        });
        flushQuote();
        if (!quote.childNodes.length) addParagraph(quote, "");
        container.appendChild(quote);
        continue;
      }
      if (isBullet(line)) {
        index = addList(container, lines, index, false);
        continue;
      }
      if (isNumber(line)) {
        index = addList(container, lines, index, true);
        continue;
      }
      var paragraph = [];
      while (index < lines.length && lines[index].trim() !== "" && !isBlockStart(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      addParagraph(container, paragraph.join(" "));
    }
  }

  function render(markdown, container) {
    if (!container) return;
    var source = String(markdown || "");
    if (source.length > MAX) source = source.slice(0, MAX);
    clear(container);
    try {
      renderBlocks(source, container, !editingHost(container));
    } catch (error) {
      clear(container);
      var paragraph = document.createElement("p");
      paragraph.textContent = source;
      container.appendChild(paragraph);
    }
  }

  function boot() {
    var source = document.getElementById("essay-source");
    var body = document.getElementById("essay-body");
    if (!source || !body || body.childNodes.length) return;
    render(source.value, body);
  }

  function linedCodeFrom(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentNode);
    if (!el || !el.closest) return null;
    var code = el.closest("code.lined");
    return code || null;
  }

  function lineRows(code) {
    var rows = [];
    var child = code.firstChild;
    while (child) {
      if (child.nodeType === 1 && child.classList.contains("line")) rows.push(child);
      child = child.nextSibling;
    }
    return rows;
  }

  function offsetInSrc(src, container, offset) {
    if (container === src) {
      var acc = 0;
      for (var i = 0; i < offset && i < src.childNodes.length; i++) acc += src.childNodes[i].textContent.length;
      return acc;
    }
    if (!src.contains(container)) return null;
    if (container.nodeType === 1) {
      var prior = 0;
      var walk = document.createTreeWalker(src, NodeFilter.SHOW_TEXT, null);
      var text = walk.nextNode();
      while (text && !container.contains(text)) {
        prior += text.textContent.length;
        text = walk.nextNode();
      }
      var inside = 0;
      for (var n = 0; n < offset && n < container.childNodes.length; n++) inside += container.childNodes[n].textContent.length;
      return prior + inside;
    }
    var seen = 0;
    var walker = document.createTreeWalker(src, NodeFilter.SHOW_TEXT, null);
    var node = walker.nextNode();
    while (node) {
      if (node === container) return seen + Math.max(0, Math.min(offset, node.textContent.length));
      seen += node.textContent.length;
      node = walker.nextNode();
    }
    return seen;
  }

  function pointOffset(src, container, offset) {
    if (container === src || src.contains(container)) return offsetInSrc(src, container, offset);
    if (container === src.parentNode) return offset <= 0 ? 0 : src.textContent.length;
    return null;
  }

  function sliceLine(src, range) {
    var line = src.parentNode;
    if (!range.intersectsNode(line)) return null;
    var text = src.textContent;
    var from = 0;
    var to = text.length;
    var start = pointOffset(src, range.startContainer, range.startOffset);
    var end = pointOffset(src, range.endContainer, range.endOffset);
    if (start != null) from = start;
    if (end != null) to = end;
    if (to < from) return text.slice(to, from);
    return text.slice(from, to);
  }

  function linedSelection(range) {
    if (!range) return null;
    var code = linedCodeFrom(range.startContainer);
    if (!code || code !== linedCodeFrom(range.endContainer)) return null;
    var rows = lineRows(code);
    var parts = [];
    var started = false;
    for (var i = 0; i < rows.length; i++) {
      var src = rows[i].querySelector(".src");
      if (!src) continue;
      var piece = sliceLine(src, range);
      if (piece == null) {
        if (started) break;
        continue;
      }
      started = true;
      parts.push(piece);
    }
    if (!started) return null;
    return parts.join("\n");
  }

  function copyLinedCode(event) {
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !event.clipboardData) return;
    var text = linedSelection(selection.getRangeAt(0));
    if (text == null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  }

  root.Essay = {
    render: render,
    safeUrl: safeUrl,
    paint: paint,
    tokenize: tokenize,
    codeLanguage: codeLanguage,
    fenceAround: fenceAround
  };

  if (typeof document !== "undefined") {
    document.addEventListener("copy", copyLinedCode);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(window);
