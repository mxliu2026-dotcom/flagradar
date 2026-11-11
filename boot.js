/*
 * FLAGRADAR loader.
 * Fetches a page source (Main.dc.html / Weekly.dc.html — the very files the design canvas publishes,
 * event data included) and mounts it with the mini runtime in rt.js.
 * Updating the site = replacing those two files. Nothing else needs a rebuild.
 *
 * Page config: window.FLAGRADAR_PAGE = { file, root, options(defaults) -> mount options, ready(component, rootEl) }
 */
(function () {
  'use strict';
  var cfg = window.FLAGRADAR_PAGE || {};
  var app = document.querySelector(cfg.root || '#app');

  function fail(msg) {
    app.textContent = '';
    var p = document.createElement('p');
    p.className = 'boot-msg';
    p.textContent = msg;
    app.appendChild(p);
  }

  function start(src) {
    var helmet = /<helmet>([\s\S]*?)<\/helmet>/.exec(src);
    var script = /<script type="text\/x-dc" data-dc-script data-props='([^']*)'>([\s\S]*?)<\/script>/.exec(src);
    var end = src.indexOf('</x-dc>');
    if (!helmet || !script || end < 0) throw new Error('页面源文件格式不对');

    var font = /<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/.exec(helmet[1]);
    if (font) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = font[1].replace(/&amp;/g, '&');
      document.head.appendChild(link);
    }
    var css = /<style>([\s\S]*?)<\/style>/.exec(helmet[1]);
    if (css) {
      var style = document.createElement('style');
      style.textContent = css[1];
      document.head.appendChild(style);
    }

    var tpl = document.createElement('template');
    tpl.innerHTML = src.slice(helmet.index + helmet[0].length, end)
      .replace(/href="Weekly\.dc\.html"/g, 'href="weekly.html"')
      .replace(/href="Main\.dc\.html"/g, 'href="./"');

    var meta = JSON.parse(script[1]), defaults = {};
    Object.keys(meta).forEach(function (k) {
      if (k.charAt(0) !== '$' && meta[k] && typeof meta[k] === 'object' && 'default' in meta[k]) defaults[k] = meta[k]['default'];
    });
    var Component = new Function('DCLogic', script[2] + '\nreturn Component;')(window.FRMini.DCLogic);

    app.textContent = '';
    var comp = window.FRMini.mount(app, tpl, Component, defaults, cfg.options ? cfg.options(defaults) : {});
    if (cfg.ready) cfg.ready(comp, app);
  }

  fetch(cfg.file + '?v=' + Math.floor(Date.now() / 600000))
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(start)
    .catch(function (e) {
      fail('加载失败（' + (e && e.message ? e.message : e) + '）。刷新重试；如果是直接双击打开的本地文件，需要通过网址访问。');
      if (window.console) console.error(e);
    });
})();
