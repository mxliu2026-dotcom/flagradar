/*
 * FLAGRADAR mini runtime.
 * Renders a declarative template against a logic class and keeps the DOM in sync.
 *   {{ a.b }}                         dotted lookup into renderVals()
 *   <sc-for list="{{ xs }}" as="x">   repeat children
 *   <sc-if value="{{ flag }}">        conditional children
 *   onClick / onChange / onKeyDown="{{ fn }}"   event handlers
 * No dependencies.
 */
(function (global) {
  'use strict';

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  var EVENTS = { onclick: 'click', onchange: 'input', oninput: 'input', onkeydown: 'keydown' };
  var XHTML = 'http://www.w3.org/1999/xhtml';

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    var parts = path.split('.'), o = scope;
    for (var i = 0; i < parts.length; i++) {
      if (o == null) return undefined;
      o = o[parts[i]];
    }
    return o;
  }

  function compileStr(s) {
    var m = WHOLE.exec(s);
    if (m) return { whole: m[1] };
    if (s.indexOf('{{') < 0) return s;
    var parts = [], last = 0;
    HOLE.lastIndex = 0;
    while ((m = HOLE.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      parts.push({ p: m[1] });
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return { parts: parts };
  }

  function evalStr(c, scope) {
    if (typeof c === 'string') return c;
    if (c.whole) return lookup(c.whole, scope);
    var out = '';
    for (var i = 0; i < c.parts.length; i++) {
      var p = c.parts[i];
      if (typeof p === 'string') out += p;
      else { var v = lookup(p.p, scope); out += v == null ? '' : v; }
    }
    return out;
  }

  function bare(s) { var m = WHOLE.exec(s || ''); return m ? m[1] : (s || ''); }

  // ---- template → compiled tree (done once)
  function compile(node) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      if (/^\s*$/.test(t) && t.indexOf('\n') >= 0) return null; // layout-only whitespace
      return { text: compileStr(t) };
    }
    if (node.nodeType !== 1) return null;
    var tag = node.localName, kids = [];
    for (var c = node.firstChild; c; c = c.nextSibling) { var k = compile(c); if (k) kids.push(k); }
    if (tag === 'sc-for') return { loop: bare(node.getAttribute('list')), as: node.getAttribute('as') || 'item', kids: kids };
    if (tag === 'sc-if') return { cond: bare(node.getAttribute('value')), kids: kids };
    var attrs = [], on = [], props = [];
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], n = a.name;
      if (n.indexOf('hint-') === 0) continue;
      if (EVENTS[n]) on.push([EVENTS[n], bare(a.value)]);
      else if (n === 'value' || n === 'checked') props.push([n, compileStr(a.value)]);
      else attrs.push([n, compileStr(a.value)]);
    }
    return { tag: tag, ns: node.namespaceURI, attrs: attrs, on: on, props: props, kids: kids };
  }

  // ---- compiled tree + values → virtual nodes
  function render(list, scope, out) {
    for (var i = 0; i < list.length; i++) {
      var n = list[i], a;
      if (n.text !== undefined) {
        var s = evalStr(n.text, scope);
        out.push({ text: s == null ? '' : String(s) });
      } else if (n.loop !== undefined) {
        var arr = lookup(n.loop, scope);
        if (arr && arr.length) {
          for (var j = 0; j < arr.length; j++) {
            var sc = Object.create(scope);
            sc[n.as] = arr[j];
            sc.$index = j;
            render(n.kids, sc, out);
          }
        }
      } else if (n.cond !== undefined) {
        if (lookup(n.cond, scope)) render(n.kids, scope, out);
      } else {
        var v = { tag: n.tag, ns: n.ns, attrs: {}, on: {}, props: {}, kids: [] };
        for (a = 0; a < n.attrs.length; a++) {
          var name = n.attrs[a][0], val = evalStr(n.attrs[a][1], scope);
          if (name.indexOf('aria-') === 0) { if (val != null) v.attrs[name] = String(val); }
          else if (val === true) v.attrs[name] = '';
          else if (val !== false && val != null) v.attrs[name] = String(val);
        }
        for (a = 0; a < n.on.length; a++) v.on[n.on[a][0]] = lookup(n.on[a][1], scope);
        for (a = 0; a < n.props.length; a++) v.props[n.props[a][0]] = evalStr(n.props[a][1], scope);
        render(n.kids, scope, v.kids);
        out.push(v);
      }
    }
  }

  // ---- virtual nodes → DOM (positional patch; nodes are reused so CSS animations keep running)
  function listen(el, type) {
    el.addEventListener(type, function (e) {
      var f = el.__h[type];
      if (typeof f === 'function') f(e);
    });
  }

  function update(el, v) {
    var old = el.__a, k;
    for (k in v.attrs) {
      if (old[k] !== v.attrs[k]) {
        if (k === 'style') el.style.cssText = v.attrs[k];
        else el.setAttribute(k, v.attrs[k]);
      }
    }
    for (k in old) if (!(k in v.attrs)) el.removeAttribute(k);
    el.__a = v.attrs;
    for (k in v.on) {
      if (!(k in el.__h)) listen(el, k);
      el.__h[k] = v.on[k];
    }
    for (k in el.__h) if (!(k in v.on)) el.__h[k] = null;
    if ('value' in v.props) {
      var val = v.props.value == null ? '' : String(v.props.value);
      if (el.value !== val) el.value = val;
    }
    if ('checked' in v.props) {
      var ch = !!v.props.checked;
      if (el.checked !== ch) el.checked = ch;
    }
    sync(el, v.kids);
  }

  function create(v) {
    if (v.text !== undefined) return document.createTextNode(v.text);
    var el = v.ns && v.ns !== XHTML ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
    el.__a = {};
    el.__h = {};
    update(el, v);
    return el;
  }

  function same(dom, v) {
    if (v.text !== undefined) return dom.nodeType === 3;
    return dom.nodeType === 1 && dom.localName === v.tag && dom.__a !== undefined;
  }

  function sync(parent, kids) {
    var dom = parent.firstChild;
    for (var i = 0; i < kids.length; i++) {
      var v = kids[i];
      if (dom && same(dom, v)) {
        if (v.text !== undefined) { if (dom.nodeValue !== v.text) dom.nodeValue = v.text; }
        else update(dom, v);
        dom = dom.nextSibling;
      } else {
        var n = create(v);
        if (dom) { parent.replaceChild(n, dom); dom = n.nextSibling; }
        else parent.appendChild(n);
      }
    }
    while (dom) {
      var next = dom.nextSibling;
      parent.removeChild(dom);
      dom = next;
    }
  }

  // ---- logic base class
  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    this.state = Object.assign({}, this.state, patch);
    if (this.__onState) this.__onState(this.state);
    if (this.__schedule) this.__schedule();
  };
  DCLogic.prototype.forceUpdate = function () {
    if (this.__schedule) this.__schedule();
  };

  function mount(root, template, Component, props, opts) {
    opts = opts || {};
    var tree = [];
    for (var c = template.content.firstChild; c; c = c.nextSibling) { var k = compile(c); if (k) tree.push(k); }
    var comp = new Component(props || {});
    if (opts.initState) comp.state = Object.assign({}, comp.state, opts.initState);
    comp.__onState = opts.onState || null;
    var pending = false;
    comp.__render = function () {
      pending = false;
      var out = [];
      render(tree, comp.renderVals(), out);
      sync(root, out);
    };
    comp.__schedule = function () {
      if (pending) return;
      pending = true;
      if (document.hidden || !global.requestAnimationFrame) setTimeout(comp.__render, 0);
      else global.requestAnimationFrame(comp.__render);
    };
    comp.__render();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
    return comp;
  }

  global.FRMini = { mount: mount, DCLogic: DCLogic };
})(window);
