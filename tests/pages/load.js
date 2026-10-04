// Minimal HTML document loader for sanitized Amazon snapshots.
// Dependency-free: enough querySelector / innerText / TreeWalker for extract() and the food gate.
'use strict';

const fs = require('fs');
const path = require('path');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'div', 'dl', 'dt', 'dd', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul']);

if (typeof global.NodeFilter === 'undefined') {
  global.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, SHOW_ALL: 0xFFFFFFFF };
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(raw || ''))) {
    attrs[m[1].toLowerCase()] = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : ''));
  }
  return attrs;
}

function createEl(tagName) {
  const tag = String(tagName || '').toLowerCase();
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    children: [],
    childNodes: [],
    attributes: {},
    parentNode: null,
    ownerDocument: null,
    get className() { return el.attributes.class || ''; },
    get id() { return el.attributes.id || ''; },
    get textContent() { return textOf(el, false); },
    set textContent(v) {
      el.childNodes = [{ nodeType: 3, textContent: String(v == null ? '' : v), data: String(v == null ? '' : v) }];
      el.children = [];
    },
    get innerText() { return textOf(el, true); },
    set innerText(v) { el.textContent = v; },
    get innerHTML() { return serializeChildren(el); },
    getAttribute(name) {
      const key = String(name || '').toLowerCase();
      return Object.prototype.hasOwnProperty.call(el.attributes, key) ? el.attributes[key] : null;
    },
    setAttribute(name, value) { el.attributes[String(name).toLowerCase()] = String(value); },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(el.attributes, String(name).toLowerCase()); },
    matches(sel) { return matchSelector(el, sel); },
    closest(sel) {
      let n = el;
      while (n && n.nodeType === 1) {
        if (matchSelector(n, sel)) return n;
        n = n.parentNode && n.parentNode.nodeType === 1 ? n.parentNode : null;
      }
      return null;
    },
    querySelector(sel) { return queryAll(el, sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(el, sel); },
    appendChild(child) {
      child.parentNode = el;
      child.ownerDocument = el.ownerDocument;
      el.childNodes.push(child);
      if (child.nodeType === 1) el.children.push(child);
      return child;
    },
  };
  return el;
}

function textOf(node, asInnerText) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent || '';
  if (node.nodeType !== 1) return '';
  const tag = node.tagName && node.tagName.toLowerCase();
  if (asInnerText && (tag === 'script' || tag === 'style' || tag === 'noscript')) return '';
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += child.textContent;
    else if (child.nodeType === 1) {
      const childTag = child.tagName.toLowerCase();
      if (asInnerText && childTag === 'br') { out += '\n'; continue; }
      const piece = textOf(child, asInnerText);
      if (asInnerText && BLOCK.has(childTag) && piece) {
        if (out && !out.endsWith('\n')) out += '\n';
        out += piece;
        if (!out.endsWith('\n')) out += '\n';
      } else {
        out += piece;
      }
    }
  }
  return asInnerText ? out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n') : out;
}

function serializeChildren(el) {
  return el.childNodes.map(n => {
    if (n.nodeType === 3) return n.textContent;
    const attrs = Object.entries(n.attributes || {}).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<${n.tagName.toLowerCase()}${attrs}>${serializeChildren(n)}</${n.tagName.toLowerCase()}>`;
  }).join('');
}

function parseFragment(html) {
  const root = createEl('fragment');
  const stack = [root];
  const src = String(html || '')
    .replace(/^\uFEFF/, '')
    .replace(/<!doctype[^>]*>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/)?([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[4] != null) {
      const text = m[4].replace(/\s+/g, ' ');
      if (!text) continue;
      stack[stack.length - 1].appendChild({
        nodeType: 3, textContent: m[4], data: m[4], parentNode: stack[stack.length - 1],
      });
      continue;
    }
    const closing = !!m[1];
    const tag = m[2].toLowerCase();
    const rawAttrs = m[3] || '';
    const selfClosing = /\/\s*$/.test(rawAttrs) || VOID.has(tag);
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const el = createEl(tag);
    el.attributes = parseAttrs(rawAttrs.replace(/\/\s*$/, ''));
    stack[stack.length - 1].appendChild(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

function walkElements(node, out = []) {
  if (node.nodeType === 1 && node.tagName !== 'FRAGMENT') out.push(node);
  for (const child of node.children || []) walkElements(child, out);
  return out;
}

function parseSimple(sel) {
  const s = String(sel || '').trim();
  if (!s) return null;
  const out = { tag: null, id: null, classes: [], attrs: [], checked: false };
  let rest = s;
  if (rest.endsWith(':checked')) {
    out.checked = true;
    rest = rest.slice(0, -8);
  }
  const tag = rest.match(/^[a-zA-Z][\w-]*/);
  if (tag) {
    out.tag = tag[0].toLowerCase();
    rest = rest.slice(tag[0].length);
  }
  const tokenRe = /#([\w-]+)|\.([\w-]+)|\[([^\]]+)\]/g;
  let m;
  while ((m = tokenRe.exec(rest))) {
    if (m[1]) out.id = m[1];
    else if (m[2]) out.classes.push(m[2]);
    else {
      const a = m[3];
      const eq = a.match(/^([\w-]+)\s*([*^$]?=)\s*(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/);
      if (eq) {
        out.attrs.push({
          name: eq[1].toLowerCase(),
          op: eq[2],
          value: eq[3] != null ? eq[3] : (eq[4] != null ? eq[4] : eq[5]),
        });
      } else {
        out.attrs.push({ name: a.trim().toLowerCase(), op: '', value: '' });
      }
    }
  }
  return out;
}

function matchSimple(el, spec) {
  if (!spec || !el || el.nodeType !== 1) return false;
  if (spec.tag && el.tagName.toLowerCase() !== spec.tag) return false;
  if (spec.id && el.id !== spec.id) return false;
  const cls = new Set((el.className || '').split(/\s+/).filter(Boolean));
  for (const c of spec.classes) if (!cls.has(c)) return false;
  for (const a of spec.attrs) {
    const got = el.getAttribute(a.name);
    if (a.op === '') {
      if (got == null) return false;
    } else if (a.op === '=') {
      if (got !== a.value) return false;
    } else if (a.op === '*=') {
      if (!got || !got.includes(a.value)) return false;
    } else if (a.op === '^=') {
      if (!got || !got.startsWith(a.value)) return false;
    } else if (a.op === '$=') {
      if (!got || !got.endsWith(a.value)) return false;
    }
  }
  if (spec.checked) {
    const selected = el.hasAttribute('selected') || el.hasAttribute('checked');
    if (!selected) return false;
  }
  return true;
}

function matchCompound(el, compound) {
  const parts = String(compound || '').trim().split(/\s+/).filter(Boolean).map(parseSimple);
  if (!parts.length) return false;
  // Right-most simple must match el; earlier parts match ancestors (descendant combinator).
  if (!matchSimple(el, parts[parts.length - 1])) return false;
  let node = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    while (node && node.nodeType === 1) {
      if (matchSimple(node, parts[i])) { found = true; node = node.parentNode; break; }
      node = node.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

function matchSelector(el, selector) {
  return String(selector || '').split(',').some(part => matchCompound(el, part.trim()));
}

function queryAll(scope, selector) {
  const list = [];
  const roots = scope.tagName === 'FRAGMENT' || scope.nodeType === 9 ? scope.children : [scope];
  const scan = [];
  for (const r of roots) walkElements(r, scan);
  // querySelector on an element does not include itself unless it is the document.
  const candidates = (scope.nodeType === 9 || scope.tagName === 'FRAGMENT')
    ? scan
    : scan.filter(n => n !== scope);
  for (const el of candidates) {
    if (matchSelector(el, selector)) list.push(el);
  }
  return list;
}

function createDocument(html, { title, url } = {}) {
  const fragment = parseFragment(html);
  const doc = {
    nodeType: 9,
    title: title || '',
    URL: url || '',
    children: fragment.children,
    childNodes: fragment.childNodes,
    documentElement: fragment.querySelector('html'),
    body: fragment.querySelector('body'),
    querySelector(sel) { return queryAll(fragment, sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(fragment, sel); },
    getElementById(id) { return fragment.querySelector('#' + id); },
    createTreeWalker(root) {
      const nodes = [];
      walkElements(root, nodes);
      let i = -1;
      return {
        nextNode() {
          i += 1;
          return i < nodes.length ? nodes[i] : null;
        },
      };
    },
  };
  if (!doc.title) {
    const t = fragment.querySelector('title');
    if (t) doc.title = t.textContent.replace(/\s+/g, ' ').trim();
  }
  for (const el of walkElements(fragment)) el.ownerDocument = doc;
  fragment.ownerDocument = doc;
  return doc;
}

function loadPage(name, opts) {
  const file = path.join(__dirname, name);
  return createDocument(fs.readFileSync(file, 'utf8'), opts);
}

module.exports = { createDocument, loadPage, PAGES_DIR: __dirname };
