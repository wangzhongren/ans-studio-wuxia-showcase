/*!
 * 江湖夜雨 · hud-ui · screens.js
 * 契约：docs/contracts/wuxia-rogue-v2-architecture-v1.md §4.7 / §5.1 / §5.3
 * 公开：WG.ui.ScreenFlow / WG.ui.score / WG.ui.screens（v1 兼容别名）
 *
 * 职责：
 *  - 持有界面状态：title → sect → playing → result；result 可回 sect 或 title。
 *  - 开始页：游戏名、副标题、三块可阅读说明、醒目的「开始游戏」。
 *  - 门派页：从 WG.sects.DEFS 读取三个竖幅卷轴；默认高亮剑宗但不自动确认。
 *  - 结算页：直接展示 run:result 传入的同一统计对象，S/A/B/C 与评语。
 *  - 只读玩法状态；不写玩家/怪物/掉落/成长数据，只发 ui:* 展示事件。
 *  - 无任何抽选/收集式界面；覆盖层类名只用 scroll-panel / stele-option。
 *  - DOM 图片回退链：generated webp → placeholder svg → 二次失败才移除节点。
 */
(function (root) {
  'use strict';

  var WG = root.WG = root.WG || {};
  var ui = WG.ui = WG.ui || {};
  var doc = (typeof root.document !== 'undefined') ? root.document : null;

  var STATES = { title: true, sect: true, playing: true, result: true };
  var SECT_ORDER = ['jianzong', 'daomen', 'yigu'];
  var OPTION_LABELS = {
    jz_combo: '连斩',
    jz_aura: '剑罡',
    dm_cleave: '裂空',
    dm_edge: '刀魄',
    yg_herb: '药息',
    yg_mend: '回春'
  };
  var GRADE_COMMENT = {
    S: '剑动江湖，血月辟易。',
    A: '锋芒毕露，已臻上乘。',
    B: '初窥门径，尚可精进。',
    C: '江湖路远，来日方长。'
  };

  var state = null;
  var rootEl = null;
  var refs = {};
  var inputBound = false;
  var busBound = false;
  var eventsBound = false;

  var sectDefs = [];
  var sectIndex = 0;

  var lastResult = null;
  var lastStats = null;
  var lastOutcome = 'dead';
  var lastScoreValue = null;
  var lastGradeValue = null;
  var legacyResult = false;
  var legacyStart = false;

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
      // 赋值失败等价于首次加载失败，仍走占位回退。
      onError();
    }
    return img;
  }

  function childList(el) {
    if (!el) { return []; }
    if (el.children && typeof el.children.length === 'number') {
      var out = [];
      for (var i = 0; i < el.children.length; i++) { out.push(el.children[i]); }
      return out;
    }
    var nodes = [];
    var list = el.childNodes || [];
    for (var j = 0; j < list.length; j++) {
      if (list[j] && list[j].nodeType === 1) { nodes.push(list[j]); }
    }
    return nodes;
  }

  function findScreen(name) {
    var list = childList(rootEl);
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute && list[i].getAttribute('data-screen') === name) {
        return list[i];
      }
    }
    return null;
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

  function collectRefs(node, out) {
    if (!node) { return; }
    if (node.getAttribute) {
      var key = node.getAttribute('data-ref');
      if (key) { out[key] = node; }
    }
    var list = childList(node);
    for (var i = 0; i < list.length; i++) { collectRefs(list[i], out); }
  }

  /* ------------------------------------------------------------------ *
   * 低优先级兜底样式（:where 为零特异性，env 的 theme.css 可随时覆盖）
   * ------------------------------------------------------------------ */
  var FALLBACK_CSS = [
    ':where(#screen-root.screens){position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(80% 70% at 50% 45%,rgba(7,10,15,.55),rgba(7,10,15,.94));opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s ease,visibility .2s linear;}',
    ':where(#screen-root.screens.is-active),:where(#screen-root.screens[data-active="true"]){opacity:1;visibility:visible;pointer-events:auto;}',
    ':where(#screen-root .screen--title),:where(#screen-root .screen--sect),:where(#screen-root .screen--result){position:relative;width:min(1120px,94vw);max-height:92vh;overflow:hidden;padding:clamp(16px,3vw,36px);justify-content:center;}',
    ':where(#screen-root .screen__bg){position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.34;pointer-events:none;z-index:0;}',
    ':where(#screen-root .screen__body){position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;max-height:calc(92vh - 48px);overflow:auto;padding:4px;}',
    ':where(#screen-root .screen__subtitle){color:var(--color-text-dim,#8fa3b0);}',
    ':where(#screen-root .title-intro){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;width:100%;margin:8px 0;}',
    ':where(#screen-root .intro-block){padding:14px 16px;text-align:left;background:rgba(17,24,37,.76);border:1px solid rgba(143,163,176,.24);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);}',
    ':where(#screen-root .intro-block__title){margin:0 0 6px;font-family:var(--font-display,"STKaiti","KaiTi",serif);font-size:20px;color:var(--color-gold-300,#f5d99c);letter-spacing:.12em;}',
    ':where(#screen-root .intro-block__text){margin:0;font-size:14px;line-height:1.65;color:var(--color-text,#e8e2d4);}',
    ':where(#screen-root .screen__actions){display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;margin-top:6px;}',
    ':where(#screen-root .screen__version){position:fixed;right:18px;bottom:12px;z-index:2;margin:0;font-size:11px;color:var(--color-text-dim,#8fa3b0);letter-spacing:.08em;opacity:.8;}',
    ':where(#screen-root .sect-list){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;width:100%;align-items:stretch;}',
    ':where(#screen-root .scroll-panel){position:relative;display:flex;flex-direction:column;gap:10px;padding:14px;min-height:340px;text-align:left;color:var(--color-text,#e8e2d4);background:linear-gradient(180deg,rgba(24,32,47,.94),rgba(11,15,22,.96));border:1px solid rgba(143,163,176,.28);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.4);cursor:pointer;outline:none;transition:transform .12s ease,border-color .12s ease,box-shadow .12s ease;}',
    ':where(#screen-root .scroll-panel:hover){border-color:rgba(232,195,122,.55);transform:translateY(-2px);}',
    ':where(#screen-root .scroll-panel.is-active){border-color:var(--color-gold-400,#e8c37a);box-shadow:0 0 0 1px rgba(232,195,122,.45),0 10px 34px rgba(0,0,0,.5);}',
    ':where(#screen-root .scroll-panel__image){width:100%;height:112px;object-fit:cover;border-radius:8px;opacity:.9;filter:sepia(.18);}',
    ':where(#screen-root .scroll-panel__name){margin:0;font-family:var(--font-display,"STKaiti","KaiTi",serif);font-size:26px;letter-spacing:.16em;color:var(--color-gold-300,#f5d99c);}',
    ':where(#screen-root .scroll-panel__role){margin:0;font-size:13px;color:var(--color-jade-300,#7de3c0);letter-spacing:.1em;}',
    ':where(#screen-root .scroll-panel__stats){display:grid;grid-template-columns:auto auto;gap:4px 10px;margin:0;padding:0;font-size:13px;}',
    ':where(#screen-root .scroll-panel__stats div){display:flex;justify-content:space-between;gap:8px;grid-column:span 2;border-bottom:1px dashed rgba(143,163,176,.16);padding-bottom:2px;}',
    ':where(#screen-root .scroll-panel__stats dt){margin:0;color:var(--color-text-dim,#8fa3b0);}',
    ':where(#screen-root .scroll-panel__stats dd){margin:0;color:var(--color-text-strong,#f6f2e8);font-weight:700;font-variant-numeric:tabular-nums;}',
    ':where(#screen-root .scroll-panel__special){margin:auto 0 0;padding-top:8px;font-size:12px;line-height:1.6;color:var(--color-text-dim,#8fa3b0);border-top:1px solid rgba(143,163,176,.18);}',
    ':where(#screen-root .score-badge){display:flex;align-items:center;justify-content:center;width:96px;height:96px;margin:2px auto;border-radius:50%;font-family:var(--font-display,"STKaiti","KaiTi",serif);font-size:54px;font-weight:700;color:var(--color-night-900,#070a0f);background:linear-gradient(180deg,var(--color-gold-300,#f5d99c),var(--color-gold-400,#e8c37a));box-shadow:0 0 28px rgba(232,195,122,.28);}',
    ':where(#screen-root .score-badge--s){background:linear-gradient(180deg,#ffe9b0,#e8c37a);box-shadow:0 0 34px rgba(255,233,176,.5);}',
    ':where(#screen-root .score-badge--a){background:linear-gradient(180deg,#b8f0d8,#4fd1a5);}',
    ':where(#screen-root .score-badge--b){background:linear-gradient(180deg,#d6e5f2,#9db7cb);}',
    ':where(#screen-root .score-badge--c){background:linear-gradient(180deg,#e9d7d2,#c39c94);}',
    ':where(#screen-root .score-comment){margin:0;font-family:var(--font-display,"STKaiti","KaiTi",serif);font-size:18px;color:var(--color-gold-300,#f5d99c);letter-spacing:.08em;}',
    ':where(#screen-root .score-value){margin:0;font-size:12px;color:var(--color-text-dim,#8fa3b0);letter-spacing:.08em;}',
    '@media (max-width:820px){',
    ':where(#screen-root .title-intro),:where(#screen-root .sect-list){grid-template-columns:1fr;}',
    ':where(#screen-root .scroll-panel){min-height:0;}',
    '}'
  ].join('\n');

  function applyFallbackStyle() {
    if (!doc || !doc.createElement || !doc.head) { return; }
    if (byId('ui-screen-fallback')) { return; }
    var style = doc.createElement('style');
    style.id = 'ui-screen-fallback';
    style.textContent = FALLBACK_CSS;
    doc.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ *
   * 容器与页面骨架
   * ------------------------------------------------------------------ */
  function ensureDom() {
    if (!doc || !doc.body) { return false; }
    if (!rootEl || !rootEl.parentNode) {
      rootEl = byId('screen-root');
      if (!rootEl) {
        rootEl = make('div', 'screens');
        rootEl.id = 'screen-root';
        doc.body.appendChild(rootEl);
      }
    }
    if (!rootEl) { return false; }
    addClass(rootEl, 'screens');
    applyFallbackStyle();

    if (!findScreen('title')) { buildTitlePage(); }
    if (!findScreen('sect')) { buildSectPage(); }
    if (!findScreen('result')) { buildResultPage(); }

    cacheRefs();
    bindPageEvents();
    return true;
  }

  function cacheRefs() {
    refs = {};
    var title = findScreen('title');
    var sect = findScreen('sect');
    var result = findScreen('result');
    if (title) { refs.title = title; collectRefs(title, refs); }
    if (sect) { refs.sect = sect; collectRefs(sect, refs); }
    if (result) { refs.result = result; collectRefs(result, refs); }
    return !!(title && sect && result);
  }

  function addIntroBlock(parent, title, text) {
    var block = make('section', 'intro-block');
    block.appendChild(make('h2', 'intro-block__title', title));
    block.appendChild(make('p', 'intro-block__text', text));
    parent.appendChild(block);
  }

  function buildTitlePage() {
    var page = make('section', 'screen screen--title');
    setAttr(page, 'data-screen', 'title');
    setAttr(page, 'aria-hidden', 'true');

    addImage(page, 'assets/generated/title-bg.webp', 'screen__bg');

    var body = make('div', 'screen__body');
    setAttr(body, 'data-ref', 'title-body');
    body.appendChild(make('h1', 'screen__title', '江湖夜雨'));
    body.appendChild(make('p', 'screen__subtitle', '武侠 · 大地图 · 自动战斗'));

    var intro = make('div', 'title-intro');
    setAttr(intro, 'data-ref', 'title-intro');
    addIntroBlock(intro, '目标', '在 8 分钟内变强，撑过血月怪潮。');
    addIntroBlock(intro, '操作', 'WASD / 方向键走位，Shift 闪身，攻击自动触发。');
    addIntroBlock(intro, '核心循环', '击杀 → 掉落 → 拾取 → 升级成长 → 更强 → 清屏。');
    body.appendChild(intro);

    var actions = make('div', 'screen__actions');
    var start = make('button', 'btn', '开始游戏');
    start.type = 'button';
    setAttr(start, 'data-action', 'start');
    setAttr(start, 'data-ref', 'title-start');
    actions.appendChild(start);
    body.appendChild(actions);
    body.appendChild(make('p', 'screen__hint', '按 Enter 或点击「开始游戏」进入门派选择'));

    var version = make('p', 'screen__version', '版本 v2 · F3 性能面板');

    page.appendChild(body);
    page.appendChild(version);
    rootEl.appendChild(page);
  }

  function buildSectPage() {
    var page = make('section', 'screen screen--sect');
    setAttr(page, 'data-screen', 'sect');
    setAttr(page, 'aria-hidden', 'true');

    var body = make('div', 'screen__body');
    body.appendChild(make('h1', 'screen__title', '择一门派'));
    body.appendChild(make('p', 'screen__subtitle', '三门传承，各有锋芒'));

    var list = make('div', 'sect-list');
    setAttr(list, 'data-ref', 'sect-list');
    body.appendChild(list);

    var actions = make('div', 'screen__actions');
    var confirm = make('button', 'btn', '踏入江湖');
    confirm.type = 'button';
    setAttr(confirm, 'data-action', 'sect-confirm');
    setAttr(confirm, 'data-ref', 'sect-confirm');
    actions.appendChild(confirm);
    body.appendChild(actions);

    var hint = make('p', 'screen__hint', '方向键 / WASD 切换 · Enter 确认 · 再次点击已选卷轴进入');
    setAttr(hint, 'data-ref', 'sect-hint');
    body.appendChild(hint);

    page.appendChild(body);
    rootEl.appendChild(page);
  }

  function addResultStat(dl, label, key) {
    var dt = make('dt', null, label);
    var dd = make('dd', null, '—');
    setAttr(dd, 'data-ref', 'result-' + key);
    dl.appendChild(dt);
    dl.appendChild(dd);
    return dd;
  }

  function buildResultPage() {
    var page = make('section', 'screen screen--result');
    setAttr(page, 'data-screen', 'result');
    setAttr(page, 'aria-hidden', 'true');

    addImage(page, 'assets/generated/ui-result.webp', 'screen__bg');

    var body = make('div', 'screen__body');
    var title = make('h1', 'screen__title', '江湖夜雨');
    setAttr(title, 'data-ref', 'result-title');
    body.appendChild(title);

    var subtitle = make('p', 'screen__subtitle', '本局战绩');
    setAttr(subtitle, 'data-ref', 'result-subtitle');
    body.appendChild(subtitle);

    var badge = make('div', 'score-badge score-badge--c', '—');
    setAttr(badge, 'data-ref', 'result-badge');
    body.appendChild(badge);

    var comment = make('p', 'score-comment', '');
    setAttr(comment, 'data-ref', 'result-comment');
    body.appendChild(comment);

    var scoreValue = make('p', 'score-value', '');
    setAttr(scoreValue, 'data-ref', 'result-score');
    body.appendChild(scoreValue);

    var dl = make('dl', 'screen__stats');
    addResultStat(dl, '存活时间', 'time');
    addResultStat(dl, '等级', 'level');
    addResultStat(dl, '击杀', 'kills');
    addResultStat(dl, '拾取', 'picks');
    addResultStat(dl, '银两', 'silver');
    addResultStat(dl, '最终攻击力', 'atk');
    body.appendChild(dl);

    var actions = make('div', 'screen__actions');
    var again = make('button', 'btn', '再来一局');
    again.type = 'button';
    setAttr(again, 'data-action', 'again');
    setAttr(again, 'data-ref', 'result-again');
    actions.appendChild(again);

    var toTitle = make('button', 'btn btn--ghost', '返回标题');
    toTitle.type = 'button';
    setAttr(toTitle, 'data-action', 'title');
    setAttr(toTitle, 'data-ref', 'result-title-btn');
    actions.appendChild(toTitle);
    body.appendChild(actions);

    body.appendChild(make('p', 'screen__hint', '按 R 再来一局'));

    page.appendChild(body);
    rootEl.appendChild(page);
  }

  function onPageClick(e) {
    var target = e && e.target;
    var action = attrUp(target, 'data-action', e && e.currentTarget);
    if (action) {
      doAction(action.value);
      return;
    }
    var panel = attrUp(target, 'data-sect-index', e && e.currentTarget);
    if (panel) {
      activateSectPanel(parseInt(panel.value, 10));
    }
  }

  function bindPageEvents() {
    if (eventsBound) { return; }
    eventsBound = true;
    if (refs.title) { refs.title.addEventListener('click', onPageClick, false); }
    if (refs.sect) { refs.sect.addEventListener('click', onPageClick, false); }
    if (refs.result) { refs.result.addEventListener('click', onPageClick, false); }
  }

  function asNumber(value) {
    if (typeof value === 'number' && isFinite(value)) { return value; }
    if (typeof value === 'string' && value.trim() !== '') {
      var n = Number(value);
      if (isFinite(n)) { return n; }
    }
    return null;
  }

  function statNumber(obj, keys, fallback) {
    if (!obj) { return fallback; }
    for (var i = 0; i < keys.length; i++) {
      var n = asNumber(obj[keys[i]]);
      if (n !== null) { return n; }
    }
    return fallback;
  }

  function numberText(value, digits) {
    var n = asNumber(value);
    if (n === null) { return '—'; }
    if (digits > 0) { return n.toFixed(digits); }
    return String(Math.round(n));
  }

  function formatDuration(totalSeconds) {
    var s = Math.max(0, Math.floor(asNumber(totalSeconds) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' + m : '' + m) + ':' + (r < 10 ? '0' + r : '' + r);
  }

  function normalizeGrade(value) {
    if (typeof value !== 'string') { return null; }
    var g = value.toUpperCase();
    return (g === 'S' || g === 'A' || g === 'B' || g === 'C') ? g : null;
  }

  function score(stats) {
    var s = stats || {};
    var kills = statNumber(s, ['kills'], 0);
    var picks = statNumber(s, ['picks', 'picked'], 0);
    var level = statNumber(s, ['level'], 0);
    var silver = statNumber(s, ['silver', 'coins'], 0);
    var seconds = statNumber(s, ['aliveSeconds', 'runTime', 'time'], 0);
    var total = kills * 2 + picks + level * 100 + silver * 2 + seconds * 0.5;
    if (!isFinite(total)) { total = 0; }
    var grade = 'C';
    if (total >= 2000) { grade = 'S'; }
    else if (total >= 1500) { grade = 'A'; }
    else if (total >= 900) { grade = 'B'; }
    return { score: total, grade: grade };
  }

  function sectReady() {
    return !!(WG.sects && WG.sects.Selection &&
      typeof WG.sects.Selection.selectSect === 'function');
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

  function getSectDefs() {
    var source = WG.sects && WG.sects.DEFS;
    if (!source) { return []; }

    var list = [];
    var seen = {};
    var i;

    if (Object.prototype.toString.call(source) === '[object Array]') {
      for (i = 0; i < source.length; i++) {
        var item = normalizeSect(source[i], source[i] && source[i].id);
        if (item && !seen[item.id]) { seen[item.id] = true; list.push(item); }
      }
      return list;
    }

    for (i = 0; i < SECT_ORDER.length; i++) {
      var key = SECT_ORDER[i];
      if (source[key]) {
        var ordered = normalizeSect(source[key], key);
        if (ordered && !seen[ordered.id]) { seen[ordered.id] = true; list.push(ordered); }
      }
    }
    for (var own in source) {
      if (!Object.prototype.hasOwnProperty.call(source, own) || seen[own]) { continue; }
      var extra = normalizeSect(source[own], own);
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

  function buildSectPanel(def, index) {
    var panel = make('div', 'scroll-panel');
    setAttr(panel, 'data-sect-index', String(index));
    setAttr(panel, 'data-sect-id', def.id);
    setAttr(panel, 'role', 'button');
    setAttr(panel, 'tabindex', '0');
    setAttr(panel, 'aria-pressed', 'false');
    setAttr(panel, 'aria-label', def.name + '，' + (def.role || '门派'));

    addImage(panel, def.image, 'scroll-panel__image');
    panel.appendChild(make('h2', 'scroll-panel__name', def.name));
    if (def.role) { panel.appendChild(make('p', 'scroll-panel__role', def.role)); }

    var dl = make('dl', 'scroll-panel__stats');
    var rows = [
      ['攻击', numberText(def.init && def.init.atk, 0)],
      ['攻击间隔', numberText(def.init && def.init.atkInterval, 2) + ' s'],
      ['最大气血', numberText(def.init && def.init.maxHp, 0)],
      ['移动速度', numberText(def.init && def.init.speed, 0) + ' px/s']
    ];
    for (var i = 0; i < rows.length; i++) {
      var row = make('div');
      row.appendChild(make('dt', null, rows[i][0]));
      row.appendChild(make('dd', null, rows[i][1]));
      dl.appendChild(row);
    }
    panel.appendChild(dl);
    panel.appendChild(make('p', 'scroll-panel__special', sectSpecialText(def)));
    return panel;
  }

  function renderSectPage() {
    if (!ensureDom()) { return; }
    sectDefs = getSectDefs();
    var list = refs['sect-list'];
    if (!list) { return; }
    clear(list);

    var hint = refs['sect-hint'];
    var confirm = refs['sect-confirm'];
    if (confirm && confirm.disabled !== undefined) { confirm.disabled = !sectDefs.length; }

    if (!sectDefs.length) {
      setText(hint, '门派数据尚未载入，请稍候');
      list.appendChild(make('p', 'screen__hint', 'WG.sects.DEFS 未就绪'));
      sectIndex = 0;
      return;
    }

    var preferred = 0;
    for (var j = 0; j < sectDefs.length; j++) {
      if (sectDefs[j].id === 'jianzong') { preferred = j; break; }
    }
    for (var i = 0; i < sectDefs.length; i++) {
      list.appendChild(buildSectPanel(sectDefs[i], i));
    }
    sectIndex = preferred;
    refreshSectHighlight();
  }

  function refreshSectHighlight() {
    var list = refs['sect-list'];
    if (!list) { return; }
    var items = childList(list);
    for (var i = 0; i < items.length; i++) {
      var idx = parseInt(items[i].getAttribute && items[i].getAttribute('data-sect-index'), 10);
      if (isNaN(idx)) { continue; }
      var on = idx === sectIndex;
      toggleClass(items[i], 'is-active', on);
      setAttr(items[i], 'aria-pressed', on ? 'true' : 'false');
    }
    var current = sectDefs[sectIndex];
    if (current) {
      setText(refs['sect-hint'], '当前：' + current.name + ' · Enter 或点击「踏入江湖」确认');
    }
  }

  function setSectIndex(index) {
    if (!sectDefs.length) { return; }
    var n = parseInt(index, 10);
    if (isNaN(n)) { return; }
    n = n % sectDefs.length;
    if (n < 0) { n += sectDefs.length; }
    sectIndex = n;
    refreshSectHighlight();
  }

  function activateSectPanel(index) {
    if (!sectDefs.length || isNaN(index)) { return; }
    if (index === sectIndex) { confirmSect(); return; }
    setSectIndex(index);
  }

  function startFromTitle() {
    if (legacyStart) { emit('ui:start'); return; }
    go('sect');
  }

  function confirmSect() {
    var def = sectDefs[sectIndex];
    if (!def) {
      setText(refs['sect-hint'], '门派数据尚未载入，请稍候');
      return;
    }
    var selection = WG.sects && WG.sects.Selection;
    if (!selection || typeof selection.selectSect !== 'function') {
      setText(refs['sect-hint'], '门派选择尚未就绪，请稍候');
      return;
    }

    // 当前门派与所选一致时，selectSect 是对局中的幂等操作，
    // 不会产生新局；改走 ui:restart，由 main 复位并进入 playing。
    var currentId = null;
    if (typeof selection.current === 'function') {
      try {
        var current = selection.current();
        if (typeof current === 'string') {
          currentId = current;
        } else if (current && typeof current.id === 'string') {
          currentId = current.id;
        }
      } catch (err) {
        currentId = null;
      }
    }

    if (currentId && currentId === def.id) {
      emit('ui:restart');
      setText(refs['sect-hint'], '江湖路远，正在启程……');
      return;
    }

    try {
      selection.selectSect(def.id);
      setText(refs['sect-hint'], '江湖路远，正在启程……');
    } catch (err) {
      setText(refs['sect-hint'], '门派载入失败，请重试');
    }
  }

  function doAction(action) {
    if (action === 'start') { startFromTitle(); }
    else if (action === 'sect-confirm') { confirmSect(); }
    else if (action === 'again') { go('sect'); }
    else if (action === 'title') { go('title'); }
  }

  function renderResultPage() {
    if (!ensureDom()) { return; }
    var stats = lastStats || {};
    var outcome = lastOutcome || stats.outcome || 'dead';
    var won = (outcome === 'win');
    var calc = score(stats);

    var scoreValue = (typeof lastScoreValue === 'number' && isFinite(lastScoreValue))
      ? lastScoreValue : calc.score;
    var grade = normalizeGrade(lastGradeValue) || calc.grade;

    setText(refs['result-title'], won ? '血月退散' : '力竭倒地');
    setText(refs['result-subtitle'], won ? '八分钟已到，你活了下来' : '江湖路远，再战一场');
    setText(refs['result-badge'], grade);
    setAttr(refs['result-badge'], 'data-grade', grade);
    setText(refs['result-comment'], GRADE_COMMENT[grade] || GRADE_COMMENT.C);
    setText(refs['result-score'], '评分 ' + (Math.round(scoreValue * 10) / 10));

    var badge = refs['result-badge'];
    if (badge) {
      removeClass(badge, 'score-badge--s');
      removeClass(badge, 'score-badge--a');
      removeClass(badge, 'score-badge--b');
      removeClass(badge, 'score-badge--c');
      addClass(badge, 'score-badge--' + grade.toLowerCase());
    }

    setText(refs['result-time'], formatDuration(statNumber(stats, ['runTime', 'aliveSeconds', 'time'], 0)));
    setText(refs['result-level'], numberText(statNumber(stats, ['level'], 1), 0));
    setText(refs['result-kills'], numberText(statNumber(stats, ['kills'], 0), 0));
    setText(refs['result-picks'], numberText(statNumber(stats, ['picks', 'picked'], 0), 0));
    setText(refs['result-silver'], numberText(statNumber(stats, ['silver', 'coins'], 0), 0));
    setText(refs['result-atk'], numberText(statNumber(stats, ['atk', 'attack', 'finalAtk'], 0), 0));
  }

  function setScreenVisible(el, on) {
    if (!el) { return; }
    toggleClass(el, 'is-active', on);
    setAttr(el, 'data-active', on ? 'true' : 'false');
    setAttr(el, 'aria-hidden', on ? 'false' : 'true');
  }

  function setRootActive(on) {
    if (!rootEl) { return; }
    toggleClass(rootEl, 'is-active', on);
    setAttr(rootEl, 'data-active', on ? 'true' : 'false');
    setAttr(rootEl, 'aria-hidden', on ? 'false' : 'true');
  }

  function setHudVisible(on) {
    var hud = byId('hud');
    if (hud && hud.hidden !== undefined) { hud.hidden = !on; }
  }

  function hideOverlays() {
    var overlays = WG.ui && WG.ui.Overlays;
    if (overlays && typeof overlays.hide === 'function') { overlays.hide(); }
  }

  function go(name) {
    if (!STATES[name]) { return state; }
    if (!ensureDom()) {
      state = name;
      return state;
    }

    state = name;
    var menu = (name !== 'playing');
    setRootActive(menu);
    setScreenVisible(refs.title, name === 'title');
    setScreenVisible(refs.sect, name === 'sect');
    setScreenVisible(refs.result, name === 'result');
    setHudVisible(!menu);

    if (name === 'sect') { renderSectPage(); }
    if (name === 'result') { renderResultPage(); }

    hideOverlays();
    bindBus();

    if (doc && doc.body && typeof doc.body.setAttribute === 'function') {
      doc.body.setAttribute('data-ui-state', name);
    }
    return state;
  }

  function current() {
    return state || 'title';
  }

  /* ------------------------------------------------------------------ *
   * 输入
   * ------------------------------------------------------------------ */
  function emit(type, payload) {
    var bus = WG.core && WG.core.Bus;
    if (bus && typeof bus.emit === 'function') {
      bus.emit(type, payload || { source: 'ui' });
    }
  }

  function overlayOpen() {
    var overlays = WG.ui && WG.ui.Overlays;
    if (overlays && typeof overlays.isOpen === 'function') {
      try { if (overlays.isOpen()) { return true; } } catch (e) { /* 忽略 */ }
    }
    var root = byId('overlay-root');
    return !!(root && root.getAttribute && root.getAttribute('data-open') === 'true');
  }

  function isEnter(e) {
    var code = e.code || '';
    var key = e.key || '';
    return code === 'Enter' || code === 'NumpadEnter' || key === 'Enter';
  }

  function isSpace(e) {
    var code = e.code || '';
    var key = e.key || '';
    return code === 'Space' || key === ' ';
  }

  function onKeyDown(e) {
    if (!e || e.repeat) { return; }
    if (overlayOpen()) { return; }
    if (!state) { return; }

    var code = e.code || '';
    var key = e.key || '';

    if (state === 'title') {
      if (isEnter(e)) {
        if (typeof e.preventDefault === 'function') { e.preventDefault(); }
        startFromTitle();
      }
      return;
    }

    if (state === 'sect') {
      if (isEnter(e) || isSpace(e)) {
        if (typeof e.preventDefault === 'function') { e.preventDefault(); }
        confirmSect();
        return;
      }
      if (code === 'ArrowLeft' || code === 'ArrowUp' || code === 'KeyA' || code === 'KeyW') {
        if (typeof e.preventDefault === 'function') { e.preventDefault(); }
        setSectIndex(sectIndex - 1);
        return;
      }
      if (code === 'ArrowRight' || code === 'ArrowDown' || code === 'KeyD' || code === 'KeyS') {
        if (typeof e.preventDefault === 'function') { e.preventDefault(); }
        setSectIndex(sectIndex + 1);
        return;
      }
      if (/^Digit[1-9]$/.test(code)) {
        if (typeof e.preventDefault === 'function') { e.preventDefault(); }
        setSectIndex(parseInt(code.slice(5), 10) - 1);
      }
      return;
    }

    if (state === 'result') {
      if (code === 'KeyR' || key === 'r' || key === 'R') {
        if (typeof e.preventDefault === 'function') { e.preventDefault(); }
        restartFromResult();
      }
    }
  }

  function restartFromResult() {
    if (legacyResult) {
      emit('ui:restart');
      return;
    }
    go('sect');
  }

  function bindInput() {
    if (inputBound || !doc || typeof doc.addEventListener !== 'function') { return; }
    inputBound = true;
    doc.addEventListener('keydown', onKeyDown, false);
  }

  /* ------------------------------------------------------------------ *
   * 事件订阅（UI 只切换自己的界面状态）
   * ------------------------------------------------------------------ */
  function onRunResult(payload) {
    if (!payload) { return; }
    lastResult = payload;
    lastStats = payload.stats || payload;
    lastOutcome = payload.outcome || (payload.stats && payload.stats.outcome) || 'dead';

    var sc = payload.score;
    if (sc && typeof sc === 'object') {
      lastScoreValue = asNumber(sc.score);
      lastGradeValue = normalizeGrade(sc.grade);
    } else {
      lastScoreValue = asNumber(sc);
      lastGradeValue = normalizeGrade(payload.grade);
    }
    legacyResult = false;
    go('result');
  }

  function onSectSelected() {
    if (state === 'sect') { go('playing'); }
  }

  function bindBus() {
    if (busBound) { return; }
    var bus = WG.core && WG.core.Bus;
    if (!bus || typeof bus.on !== 'function') { return; }
    busBound = true;
    bus.on('run:result', onRunResult);
    bus.on('sect:selected', onSectSelected);
  }

  /* ------------------------------------------------------------------ *
   * v1 兼容别名（main.js 升级到 ScreenFlow 前仍可安全加载）
   * ------------------------------------------------------------------ */
  function showTitleLegacy() {
    legacyStart = true;
    legacyResult = false;
    return go('title');
  }

  function showResultLegacy(result) {
    legacyStart = !sectReady();
    legacyResult = true;
    lastResult = result || {};
    lastStats = result || {};
    lastOutcome = (result && result.outcome) || 'dead';
    lastScoreValue = null;
    lastGradeValue = null;
    return go('result');
  }

  function hideLegacy() {
    legacyResult = false;
    return go('playing');
  }

  ui.ScreenFlow = {
    go: go,
    current: current,
    bindInput: bindInput
  };

  ui.score = score;

  ui.screens = {
    showTitle: showTitleLegacy,
    showResult: showResultLegacy,
    hide: hideLegacy,
    bindInput: bindInput,
    go: go,
    current: current
  };

  function init() {
    if (!doc) { return; }
    bindBus();
    bindInput();
    if (!state) { go('title'); }
  }

  if (doc) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', init, false);
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
