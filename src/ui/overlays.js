/*!
 * 江湖夜雨 · hud-ui · overlays.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.7 / §5.1 / §5.3
 * 公开：WG.ui.Overlays = { showSect(defs,onPick), showChoice(options,onPick), hide() }
 *
 * 职责：
 *  - 门派卷轴覆盖层与升级石碑覆盖层；类名只用 scroll-panel / stele-option。
 *  - 方向键/WASD 移动高亮，Enter/点击确认；未操作前不自动回调。
 *  - 不写玩法状态；选择后只回调 onPick，由调用方经公开 API 应用。
 *  - DOM 图片回退链：generated webp → placeholder svg → 二次失败才移除节点。
 *  - 严格无抽选/收集式界面，无相关命名与图标。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var ui = WG.ui = WG.ui || {};
  var doc = (typeof root.document !== 'undefined') ? root.document : null;

  var SECT_ORDER = ['jianzong', 'daomen', 'yigu'];
  var OPTION_LABELS = {
    jz_combo: '连斩',
    jz_aura: '剑罡',
    dm_cleave: '裂空',
    dm_edge: '刀魄',
    yg_herb: '药息',
    yg_mend: '回春'
  };

  var rootEl = null;
  var openKind = null;
  var options = [];
  var optionEls = [];
  var activeIndex = 0;
  var onPick = null;
  var inputBound = false;
  var busBound = false;

  /* ------------------------------------------------------------------ *
   * DOM 基础
   * ------------------------------------------------------------------ */
  function make(tag, className, text) {
    var el = doc.createElement(tag);
    if (className) { el.className = className; }
    if (typeof text === 'string') { el.textContent = text; }
    return el;
  }

  function setText(el, value) {
    if (el && el.textContent !== value) { el.textContent = value; }
  }

  function setAttr(el, name, value) {
    if (el && typeof el.setAttribute === 'function') { el.setAttribute(name, value); }
  }

  function byId(id) {
    return doc ? doc.getElementById(id) : null;
  }

  function addClass(el, name) {
    if (el && el.classList && !el.classList.contains(name)) { el.classList.add(name); }
  }

  function removeClass(el, name) {
    if (el && el.classList && el.classList.contains(name)) { el.classList.remove(name); }
  }

  function toggleClass(el, name, on) {
    if (!el || !el.classList) { return; }
    if (on) { addClass(el, name); } else { removeClass(el, name); }
  }

  function clear(el) {
    if (!el) { return; }
    el.textContent = '';
  }

  /** generated 路径 → 同 id 占位 SVG；非 generated 路径不推导。 */
  function placeholderFor(src) {
    if (typeof src !== 'string' || !src) { return ''; }
    var m = /(^|\/)assets\/generated\/([^\/]+)\.(?:webp|png|jpe?g)$/i.exec(src);
    if (!m) { return ''; }
    return (m[1] || '') + 'assets/placeholder-' + m[2] + '.svg';
  }

  function addImage(parent, src, className) {
    if (!parent || !src) { return null; }
    var img = make('img', className);
    img.alt = '';
    setAttr(img, 'aria-hidden', 'true');

    var placeholder = placeholderFor(src);
    var failedOnce = false;

    function removeImage() {
      if (img.parentNode) { img.parentNode.removeChild(img); }
    }

    // 一个 error 监听器：generated 失败切 placeholder，placeholder 再失败才移除。
    function onError() {
      if (!failedOnce && placeholder && placeholder !== src) {
        failedOnce = true;
        try {
          img.src = placeholder;
        } catch (e) {
          removeImage();
        }
        return;
      }
      removeImage();
    }

    img.addEventListener('error', onError, false);

    parent.appendChild(img);
    try {
      img.src = src;
    } catch (e) {
      onError();
    }
    return img;
  }

  function attrUp(node, attr, stop) {
    var cur = node;
    while (cur && cur !== stop) {
      if (cur.getAttribute) {
        var value = cur.getAttribute(attr);
        if (value !== null && value !== undefined) { return { node: cur, value: value }; }
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function asNumber(value) {
    if (typeof value === 'number' && isFinite(value)) { return value; }
    if (typeof value === 'string' && value.trim() !== '') {
      var n = Number(value);
      if (isFinite(n)) { return n; }
    }
    return null;
  }

  function numberText(value, digits) {
    var n = asNumber(value);
    if (n === null) { return '—'; }
    if (digits > 0) { return n.toFixed(digits); }
    return String(Math.round(n));
  }

  /* ------------------------------------------------------------------ *
   * 低优先级兜底样式（:where 为零特异性，env 的 theme.css 可覆盖）
   * ------------------------------------------------------------------ */
  var FALLBACK_CSS = [
    ':where(#overlay-root){position:fixed;inset:0;z-index:25;pointer-events:none;}',
    ':where(#overlay-root[data-open="true"]){pointer-events:auto;}',
    ':where(#overlay-root .overlay){position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(70% 65% at 50% 45%,rgba(7,10,15,.72),rgba(7,10,15,.94));}',
    ':where(#overlay-root .overlay__bg){position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.28;pointer-events:none;z-index:0;}',
    ':where(#overlay-root .overlay__panel){position:relative;z-index:1;width:min(1000px,94vw);max-height:90vh;overflow:auto;padding:clamp(16px,3vw,30px);text-align:center;background:rgba(11,15,22,.9);border:1px solid rgba(232,195,122,.35);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.65);}',
    // 升级选择：仅 choice 使用透明外层/面板；sect 仍保留 ui-stele 背景与暗色面板。
    '#overlay-root .overlay.overlay--choice{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;}',
    '#overlay-root .overlay--choice .overlay__panel{background:transparent;border:0;box-shadow:none;}',
    '#overlay-root .overlay--choice .overlay__title,#overlay-root .overlay--choice .overlay__subtitle,#overlay-root .overlay--choice .overlay__hint{text-shadow:0 1px 4px rgba(7,10,15,.9),0 0 10px rgba(7,10,15,.65);}',
    ':where(#overlay-root .overlay__title){margin:0 0 6px;font-family:var(--font-display,"STKaiti","KaiTi",serif);font-size:clamp(24px,4vw,38px);letter-spacing:.18em;color:var(--color-gold-300,#f5d99c);}',
    ':where(#overlay-root .overlay__subtitle){margin:0 0 14px;font-size:13px;letter-spacing:.08em;color:var(--color-text-dim,#8fa3b0);}',
    ':where(#overlay-root .overlay__hint){margin:14px 0 0;font-size:12px;letter-spacing:.06em;color:var(--color-text-dim,#8fa3b0);}',
    ':where(#overlay-root .stele-list){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}',
    ':where(#overlay-root .stele-option){position:relative;display:flex;flex-direction:column;gap:8px;padding:16px;min-height:190px;text-align:left;color:var(--color-text,#e8e2d4);background:linear-gradient(180deg,rgba(24,32,47,.96),rgba(11,15,22,.98));border:1px solid rgba(143,163,176,.3);border-radius:12px;box-shadow:0 8px 26px rgba(0,0,0,.42);cursor:pointer;outline:none;appearance:none;font:inherit;transition:transform .12s ease,border-color .12s ease,box-shadow .12s ease;}',
    ':where(#overlay-root .stele-option:hover){border-color:rgba(232,195,122,.55);transform:translateY(-2px);}',
    ':where(#overlay-root .stele-option.is-active){border-color:var(--color-gold-400,#e8c37a);box-shadow:0 0 0 1px rgba(232,195,122,.45),0 12px 34px rgba(0,0,0,.52);}',
    ':where(#overlay-root .stele-option__top){display:flex;align-items:center;gap:10px;}',
    ':where(#overlay-root .stele-option__icon){display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;flex:0 0 auto;border-radius:50%;font-family:var(--font-display,"STKaiti","KaiTi",serif);font-size:22px;color:var(--color-night-900,#070a0f);background:linear-gradient(180deg,var(--color-gold-300,#f5d99c),var(--color-gold-400,#e8c37a));}',
    ':where(#overlay-root .stele-option__name){margin:0;flex:1;font-family:var(--font-display,"STKaiti","KaiTi",serif);font-size:24px;letter-spacing:.1em;color:var(--color-text-strong,#f6f2e8);}',
    ':where(#overlay-root .stele-option__type){align-self:flex-start;padding:2px 8px;font-size:11px;letter-spacing:.12em;color:var(--color-jade-300,#7de3c0);border:1px solid rgba(79,209,165,.35);border-radius:999px;}',
    ':where(#overlay-root .stele-option__desc){margin:auto 0 0;font-size:14px;line-height:1.65;color:var(--color-text,#e8e2d4);}',
    ':where(#overlay-root .scroll-list){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}',
    ':where(#overlay-root .scroll-panel){position:relative;display:flex;flex-direction:column;gap:8px;padding:14px;min-height:300px;text-align:left;color:var(--color-text,#e8e2d4);background:linear-gradient(180deg,rgba(24,32,47,.96),rgba(11,15,22,.98));border:1px solid rgba(143,163,176,.3);border-radius:12px;box-shadow:0 8px 26px rgba(0,0,0,.42);cursor:pointer;outline:none;font:inherit;transition:transform .12s ease,border-color .12s ease,box-shadow .12s ease;}',
    ':where(#overlay-root .scroll-panel:hover){border-color:rgba(232,195,122,.55);transform:translateY(-2px);}',
    ':where(#overlay-root .scroll-panel.is-active){border-color:var(--color-gold-400,#e8c37a);box-shadow:0 0 0 1px rgba(232,195,122,.45),0 12px 34px rgba(0,0,0,.52);}',
    ':where(#overlay-root .scroll-panel__image){width:100%;height:96px;object-fit:cover;border-radius:8px;opacity:.9;filter:sepia(.18);}',
    ':where(#overlay-root .scroll-panel__name){margin:0;font-family:var(--font-display,"STKaiti","KaiTi",serif);font-size:24px;letter-spacing:.12em;color:var(--color-gold-300,#f5d99c);}',
    ':where(#overlay-root .scroll-panel__role){margin:0;font-size:12px;color:var(--color-jade-300,#7de3c0);}',
    ':where(#overlay-root .scroll-panel__stats){display:flex;flex-direction:column;gap:3px;margin:0;font-size:12px;}',
    ':where(#overlay-root .scroll-panel__stats div){display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed rgba(143,163,176,.16);padding-bottom:2px;}',
    ':where(#overlay-root .scroll-panel__stats dt){margin:0;color:var(--color-text-dim,#8fa3b0);}',
    ':where(#overlay-root .scroll-panel__stats dd){margin:0;font-weight:700;color:var(--color-text-strong,#f6f2e8);font-variant-numeric:tabular-nums;}',
    ':where(#overlay-root .scroll-panel__special){margin:auto 0 0;padding-top:8px;font-size:11px;line-height:1.6;color:var(--color-text-dim,#8fa3b0);border-top:1px solid rgba(143,163,176,.18);}',
    '@media (max-width:820px){',
    ':where(#overlay-root .stele-list),:where(#overlay-root .scroll-list){grid-template-columns:1fr;}',
    ':where(#overlay-root .stele-option),:where(#overlay-root .scroll-panel){min-height:0;}',
    '}'
  ].join('\n');

  function applyFallbackStyle() {
    if (!doc || !doc.createElement || !doc.head) { return; }
    if (byId('ui-overlay-fallback')) { return; }
    var style = doc.createElement('style');
    style.id = 'ui-overlay-fallback';
    style.textContent = FALLBACK_CSS;
    doc.head.appendChild(style);
  }

  function ensureRoot() {
    if (!doc || !doc.body) { return false; }
    if (!rootEl || !rootEl.parentNode) {
      rootEl = byId('overlay-root');
      if (!rootEl) {
        rootEl = make('div', 'overlays');
        rootEl.id = 'overlay-root';
        doc.body.appendChild(rootEl);
      }
    }
    if (!rootEl) { return false; }
    addClass(rootEl, 'overlays');
    applyFallbackStyle();
    return true;
  }

  function normalizeOption(raw, index) {
    if (raw === null || raw === undefined) { return null; }
    if (typeof raw !== 'object') {
      return { id: String(raw), name: String(raw), desc: '', kind: '', icon: '' };
    }
    return {
      id: raw.id !== undefined ? String(raw.id) : ('option-' + index),
      name: raw.name || raw.title || raw.id || ('传承 ' + (index + 1)),
      desc: raw.desc || raw.description || raw.effect || raw.text || '',
      kind: raw.kind || raw.type || raw.tag || '',
      icon: raw.icon || raw.image || ''
    };
  }

  function normalizeSect(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') { return null; }
    var id = raw.id || fallbackId;
    if (!id) { return null; }
    return {
      id: String(id),
      name: raw.name || raw.title || String(id),
      role: raw.role || raw.desc || raw.description || '',
      init: raw.init || raw.stats || raw.initial || {},
      exclusive: raw.exclusive || raw.special || raw.passive || null,
      exclusiveText: raw.exclusiveText || raw.specialText || '',
      image: raw.image || raw.imagePath || ('assets/generated/sect-' + id + '.webp')
    };
  }

  function getSectDefs(defs) {
    if (!defs) { return []; }
    var list = [];
    var seen = {};
    var i;

    if (Object.prototype.toString.call(defs) === '[object Array]') {
      for (i = 0; i < defs.length; i++) {
        var item = normalizeSect(defs[i], defs[i] && defs[i].id);
        if (item && !seen[item.id]) { seen[item.id] = true; list.push(item); }
      }
      return list;
    }

    for (i = 0; i < SECT_ORDER.length; i++) {
      var key = SECT_ORDER[i];
      if (defs[key]) {
        var ordered = normalizeSect(defs[key], key);
        if (ordered && !seen[ordered.id]) { seen[ordered.id] = true; list.push(ordered); }
      }
    }
    for (var own in defs) {
      if (!Object.prototype.hasOwnProperty.call(defs, own) || seen[own]) { continue; }
      var extra = normalizeSect(defs[own], own);
      if (extra && !seen[extra.id]) { seen[extra.id] = true; list.push(extra); }
    }
    return list;
  }

  function labelForOption(entry) {
    if (!entry) { return ''; }
    if (typeof entry === 'string') { return OPTION_LABELS[entry] || entry; }
    if (typeof entry === 'object') {
      return entry.name || OPTION_LABELS[entry.id] || entry.id || '';
    }
    return '';
  }

  function sectSpecialText(def) {
    if (def.exclusiveText) { return '专属成长：' + def.exclusiveText; }
    var source = def.exclusive;
    var names = [];
    if (source) {
      if (Object.prototype.toString.call(source) === '[object Array]') {
        for (var i = 0; i < source.length; i++) {
          var label = labelForOption(source[i]);
          if (label) { names.push(label); }
        }
      } else {
        var single = labelForOption(source);
        if (single) { names.push(single); }
      }
    }
    if (!names.length) { return '专属成长：随门派传承逐步显现'; }
    return '专属成长：' + names.join(' · ');
  }

  function kindLabel(kind) {
    if (!kind) { return '传承'; }
    var raw = String(kind);
    var key = raw.toLowerCase();
    if (key === 'common' || key === 'general' || key === 'universal') { return '通用'; }
    if (key === 'sect' || key === 'exclusive' || key === 'school') { return '门派'; }
    if (key === 'ultimate' || key === 'master' || key === 'secret') { return '绝学'; }
    if (/[一-龥]/.test(raw)) { return raw; }
    return '传承';
  }

  function buildChoiceOption(opt, index) {
    var el = make('button', 'stele-option');
    el.type = 'button';
    setAttr(el, 'data-option-index', String(index));
    setAttr(el, 'data-option-id', opt.id);
    setAttr(el, 'aria-pressed', 'false');

    var top = make('div', 'stele-option__top');
    if (opt.icon && String(opt.icon).indexOf('/') >= 0) {
      addImage(top, opt.icon, 'stele-option__icon');
    } else {
      top.appendChild(make('span', 'stele-option__icon', opt.icon || '✦'));
    }
    top.appendChild(make('span', 'stele-option__name', opt.name));
    el.appendChild(top);
    el.appendChild(make('span', 'stele-option__type', kindLabel(opt.kind)));
    el.appendChild(make('p', 'stele-option__desc', opt.desc || '选择后立即生效。'));
    return el;
  }

  function buildSectPanel(def, index) {
    var el = make('div', 'scroll-panel');
    setAttr(el, 'data-option-index', String(index));
    setAttr(el, 'data-option-id', def.id);
    setAttr(el, 'role', 'button');
    setAttr(el, 'tabindex', '0');
    setAttr(el, 'aria-pressed', 'false');

    addImage(el, def.image, 'scroll-panel__image');
    el.appendChild(make('h3', 'scroll-panel__name', def.name));
    if (def.role) { el.appendChild(make('p', 'scroll-panel__role', def.role)); }

    var dl = make('dl', 'scroll-panel__stats');
    var rows = [
      ['攻击', numberText(def.init && def.init.atk, 0)],
      ['间隔', numberText(def.init && def.init.atkInterval, 2) + ' s'],
      ['气血', numberText(def.init && def.init.maxHp, 0)],
      ['移速', numberText(def.init && def.init.speed, 0)]
    ];
    for (var i = 0; i < rows.length; i++) {
      var row = make('div');
      row.appendChild(make('dt', null, rows[i][0]));
      row.appendChild(make('dd', null, rows[i][1]));
      dl.appendChild(row);
    }
    el.appendChild(dl);
    el.appendChild(make('p', 'scroll-panel__special', sectSpecialText(def)));
    return el;
  }

  function buildOverlay() {
    clear(rootEl);
    optionEls = [];

    var isChoice = openKind === 'choice';
    var wrapper = make('div', isChoice ? 'overlay overlay--choice' : 'overlay');
    setAttr(wrapper, 'role', 'dialog');
    setAttr(wrapper, 'aria-modal', 'true');
    setAttr(wrapper, 'data-overlay-kind', isChoice ? 'choice' : 'sect');
    setAttr(wrapper, 'aria-label', isChoice ? '选择传承' : '选择门派');

    // 升级选择透明弹出：choice 不请求任何背景图；门派仍使用 ui-stele 背景。
    if (!isChoice) {
      addImage(wrapper, 'assets/generated/ui-stele.webp', 'overlay__bg');
    }

    var panel = make('div', 'overlay__panel');
    panel.appendChild(make(
      'h2',
      'overlay__title',
      openKind === 'choice' ? '择一精进' : '择一门派'
    ));
    panel.appendChild(make(
      'p',
      'overlay__subtitle',
      openKind === 'choice' ? '选择一项传承，立即生效' : '三门卷轴，各承其道'
    ));

    var list = make('div', openKind === 'choice' ? 'stele-list' : 'scroll-list');
    for (var i = 0; i < options.length; i++) {
      var el = openKind === 'choice'
        ? buildChoiceOption(options[i], i)
        : buildSectPanel(options[i], i);
      optionEls.push(el);
      list.appendChild(el);
    }
    panel.appendChild(list);
    panel.appendChild(make(
      'p',
      'overlay__hint',
      openKind === 'choice'
        ? '方向键 / WASD 切换 · Enter 或点击确认'
        : '方向键 / WASD 切换 · Enter 或点击进入'
    ));

    wrapper.appendChild(panel);
    rootEl.appendChild(wrapper);
  }

  function refreshHighlight() {
    for (var i = 0; i < optionEls.length; i++) {
      var on = (i === activeIndex);
      toggleClass(optionEls[i], 'is-active', on);
      setAttr(optionEls[i], 'aria-pressed', on ? 'true' : 'false');
    }
  }

  function setActiveIndex(index) {
    if (!options.length) { return; }
    var n = parseInt(index, 10);
    if (isNaN(n)) { return; }
    n = n % options.length;
    if (n < 0) { n += options.length; }
    activeIndex = n;
    refreshHighlight();
  }

  function move(delta) {
    if (!options.length) { return; }
    setActiveIndex(activeIndex + delta);
  }

  function isOpen() {
    return openKind !== null;
  }

  function show(kind, list, callback) {
    if (!ensureRoot()) { return; }
    openKind = kind;
    options = list || [];
    onPick = (typeof callback === 'function') ? callback : null;
    activeIndex = 0;

    if (kind === 'sect') {
      for (var i = 0; i < options.length; i++) {
        if (options[i].id === 'jianzong') { activeIndex = i; break; }
      }
    }

    buildOverlay();
    refreshHighlight();
    setAttr(rootEl, 'data-open', 'true');
    setAttr(rootEl, 'aria-hidden', 'false');
    addClass(rootEl, 'is-open');
    bindInput();
    bindBus();
  }

  function showChoice(list, callback) {
    var normalized = [];
    var source = list || [];
    for (var i = 0; i < source.length; i++) {
      var opt = normalizeOption(source[i], i);
      if (opt) { normalized.push(opt); }
    }
    if (!normalized.length) { hide(); return; }
    show('choice', normalized, callback);
  }

  function showSect(defs, callback) {
    var normalized = getSectDefs(defs);
    if (!normalized.length) { hide(); return; }
    show('sect', normalized, callback);
  }

  function hide() {
    openKind = null;
    options = [];
    optionEls = [];
    onPick = null;
    activeIndex = 0;
    if (!rootEl) { return; }
    clear(rootEl);
    removeClass(rootEl, 'is-open');
    setAttr(rootEl, 'data-open', 'false');
    setAttr(rootEl, 'aria-hidden', 'true');
  }

  function confirmCurrent() {
    if (!openKind || !options.length) { return; }
    var callback = onPick;
    var picked = options[activeIndex];
    if (!picked) { return; }
    try {
      if (callback) { callback(picked); }
    } catch (err) {
      if (root.console && typeof root.console.error === 'function') {
        root.console.error('ui overlay callback failed', err);
      }
    } finally {
      hide();
    }
  }

  /* ------------------------------------------------------------------ *
   * 输入与点击
   * ------------------------------------------------------------------ */
  function onKeyDown(e) {
    if (!openKind || !e || e.repeat) { return; }
    var code = e.code || '';
    var key = e.key || '';

    if (code === 'ArrowLeft' || code === 'ArrowUp' || code === 'KeyA' || code === 'KeyW') {
      if (typeof e.preventDefault === 'function') { e.preventDefault(); }
      move(-1);
      return;
    }
    if (code === 'ArrowRight' || code === 'ArrowDown' || code === 'KeyD' || code === 'KeyS') {
      if (typeof e.preventDefault === 'function') { e.preventDefault(); }
      move(1);
      return;
    }
    if (code === 'Enter' || code === 'NumpadEnter' || key === 'Enter' ||
        code === 'Space' || key === ' ') {
      if (typeof e.preventDefault === 'function') { e.preventDefault(); }
      confirmCurrent();
      return;
    }
    if (/^Digit[1-9]$/.test(code)) {
      if (typeof e.preventDefault === 'function') { e.preventDefault(); }
      setActiveIndex(parseInt(code.slice(5), 10) - 1);
    }
  }

  function onClick(e) {
    if (!openKind) { return; }
    var found = attrUp(e && e.target, 'data-option-index', rootEl);
    if (!found) { return; }
    var index = parseInt(found.value, 10);
    if (isNaN(index)) { return; }
    activeIndex = index;
    refreshHighlight();
    confirmCurrent();
  }

  function bindInput() {
    if (inputBound || !doc || typeof doc.addEventListener !== 'function') { return; }
    inputBound = true;
    doc.addEventListener('keydown', onKeyDown, false);
    if (rootEl) { rootEl.addEventListener('click', onClick, false); }
  }

  function bindBus() {
    if (busBound) { return; }
    var bus = WG.core && WG.core.Bus;
    if (!bus || typeof bus.on !== 'function') { return; }
    busBound = true;

    bus.on('choice:offer', function (payload) {
      if (!payload || !payload.options) { return; }
      showChoice(payload.options, function (option) {
        var selection = WG.sects && WG.sects.Selection;
        if (selection && typeof selection.choose === 'function') {
          selection.choose(option.id);
        }
      });
    });

    bus.on('choice:pick', function () {
      hide();
    });
  }

  var api = {
    showSect: showSect,
    showChoice: showChoice,
    hide: hide
  };

  try {
    Object.defineProperty(api, 'isOpen', { value: isOpen, enumerable: false });
  } catch (e) {
    api.isOpen = isOpen;
  }

  ui.Overlays = api;

  function init() {
    if (!doc) { return; }
    if (ensureRoot()) {
      setAttr(rootEl, 'data-open', 'false');
      setAttr(rootEl, 'aria-hidden', 'true');
    }
    bindInput();
    bindBus();
  }

  if (doc) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', init, false);
    } else {
      init();
    }
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
