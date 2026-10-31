/*!
 * 江湖夜雨 · tests/art-render-check.js
 *
 * integration-check 的回归子模块：共享图片加载链（generated → placeholder → missing）
 * 与渲染回退桥（Combat/Monster/fx 在有图/无图下都不抛错）。
 *
 * 由 tests/integration-check.js 在假 DOM 环境下注册；不单独运行、不引入依赖。
 * 约束：只读 src/** 与 index.html，不改产品代码，不联网。
 */
'use strict';

module.exports = function registerArtRenderChecks(env) {
  var phase = env.phase;
  var ok = env.ok;
  var eq = env.eq;
  var world = env.world;
  var ctx = env.ctx;
  var renderSpy = env.renderSpy;
  var FakeImage = env.FakeImage;
  var fakeImageInstances = env.fakeImageInstances;
  var WG = env.WG;
  var core = env.core;
  var fs = env.fs;
  var path = env.path;
  var root = env.root;
  var indexHtml = env.indexHtml;
  var actualOrder = env.actualOrder;
  var SRC_ORDER = env.SRC_ORDER;
  var PERF_SCRIPT = env.PERF_SCRIPT;
  var LOAD_ORDER = env.LOAD_ORDER;

  /* ---------- 6.5) 美术加载链 / 渲染回退桥 ---------- */

  phase('美术加载链与渲染回退桥', function () {
    if (!world) { return; }

    var fx = WG.fx || {};
    var assets = fx.assets;
    ok(assets && typeof assets.draw === 'function' &&
      typeof assets.get === 'function' &&
      typeof assets.ready === 'function' &&
      typeof assets.preload === 'function',
      'WG.fx.assets.{draw,get,ready,preload} 可用');

    // 1) generated 成功：draw=true、drawImage 一次、ready/get 一致
    var idOk = 'art-ok';
    FakeImage.setMode(idOk, 'success');
    var drawBefore = renderSpy.drawImage;
    var okThrew = false;
    var okDrawn = false;
    try {
      okDrawn = assets.draw(ctx, idOk, 100, 100, 32, 32);
    } catch (err) {
      okThrew = true;
    }
    ok(!okThrew && okDrawn === true, 'generated 加载成功时 draw 返回 true');
    eq(renderSpy.drawImage, drawBefore + 1, 'generated 成功时 ctx.drawImage 被调用一次');
    ok(assets.ready(idOk) === true, 'generated 成功后 ready(id)=true');
    ok(assets.get(idOk) === FakeImage.get(idOk), 'get(id) 返回同一 Image');
    eq(FakeImage.instancesFor(idOk).length, 1, '同一 id 只创建一个 Image');
    var imgOk = FakeImage.get(idOk);
    ok(imgOk && imgOk.srcHistory.length === 1 &&
      /assets\/generated\/art-ok\.webp$/.test(imgOk.src),
      '首次请求路径为 assets/generated/<id>.webp',
      imgOk ? imgOk.src : 'no img');

    // 2) generated 失败 → placeholder：draw=true、最终 src 为占位、只回退一次
    var idFb = 'art-fallback';
    FakeImage.setMode(idFb, 'fallback');
    drawBefore = renderSpy.drawImage;
    var fbThrew = false;
    var fbDrawn = false;
    try {
      fbDrawn = assets.draw(ctx, idFb, 120, 120, 24, 24);
    } catch (err) {
      fbThrew = true;
    }
    ok(!fbThrew && fbDrawn === true, 'generated 失败后占位图成功时 draw 返回 true');
    eq(renderSpy.drawImage, drawBefore + 1, '占位图成功时 ctx.drawImage 被调用一次');
    var imgFb = FakeImage.get(idFb);
    ok(!!imgFb, '占位回退复用了同一个 Image（存在缓存）');
    ok(imgFb && imgFb.srcHistory.length === 2 &&
      /assets\/generated\/art-fallback\.webp$/.test(imgFb.srcHistory[0]) &&
      /assets\/placeholder-art-fallback\.svg$/.test(imgFb.src),
      '加载链为 generated.webp → placeholder.svg',
      imgFb ? imgFb.srcHistory.join(' -> ') : 'no img');
    ok(assets.ready(idFb) === true, '占位图成功后 ready(id)=true');
    if (imgFb) {
      var fbHistory = imgFb.srcHistory.length;
      imgFb.onerror();
      eq(imgFb.srcHistory.length, fbHistory,
        '占位图成功后再次 error 不再重复回退');
      ok(assets.ready(idFb) === true, '占位图成功后仍保持 ready');
    }

    // 3) 两级都失败：draw=false、不抛错、ready=false、重复调用仍 false
    var idMiss = 'art-missing';
    FakeImage.setMode(idMiss, 'fail');
    var missThrew = false;
    var missDrawn = true;
    try {
      missDrawn = assets.draw(ctx, idMiss, 140, 140, 24, 24);
    } catch (err) {
      missThrew = true;
    }
    ok(!missThrew && missDrawn === false, '两级都失败时 draw 返回 false 且不抛错');
    ok(assets.ready(idMiss) === false, '两级都失败时 ready(id)=false');
    ok(assets.get(idMiss) === null, '两级都失败时 get(id)=null');
    var imgMiss = FakeImage.get(idMiss);
    ok(imgMiss && imgMiss.srcHistory.length === 2 &&
      /assets\/placeholder-art-missing\.svg$/.test(imgMiss.src),
      '两级失败仍只尝试 generated + placeholder 两次',
      imgMiss ? imgMiss.srcHistory.join(' -> ') : 'no img');
    eq(FakeImage.instancesFor(idMiss).length, 1, 'missing 也不重复创建 Image');
    ok(assets.draw(ctx, idMiss, 140, 140, 24, 24) === false,
      'missing 状态重复 draw 仍返回 false');
    if (imgMiss) {
      var missHistory = imgMiss.srcHistory.length;
      imgMiss.onerror();
      eq(imgMiss.srcHistory.length, missHistory, 'missing 状态重复 error 不再重试');
    }
    ok(assets.ready(idMiss) === false, 'missing 状态重复调用后 ready 仍为 false');

    // 4) 环境缺失：无全局 Image / ctx 无 drawImage
    var savedImage = globalThis.Image;
    var noImageThrew = false;
    var noImageDraw = true;
    var noImageReady = true;
    try {
      globalThis.Image = undefined;
      noImageDraw = assets.draw(ctx, 'art-no-image', 10, 10, 16, 16);
      assets.preload(['art-no-image-a', 'art-no-image-b']);
      noImageReady = assets.ready('art-no-image');
    } catch (err) {
      noImageThrew = true;
    } finally {
      globalThis.Image = savedImage;
    }
    ok(!noImageThrew && noImageDraw === false,
      '无全局 Image 时 draw 返回 false 且不抛错');
    ok(noImageReady === false, '无全局 Image 时 ready=false');

    var noCtxThrew = false;
    var noCtxDraw = true;
    try {
      noCtxDraw = assets.draw({}, 'art-no-ctx', 10, 10, 16, 16);
    } catch (err) {
      noCtxThrew = true;
    }
    ok(!noCtxThrew && noCtxDraw === false,
      'ctx 无 drawImage 时 draw 返回 false 且不抛错');

    var preloadThrew = false;
    try {
      assets.preload(['art-preload-a', 'art-preload-b']);
    } catch (err) {
      preloadThrew = true;
    }
    ok(!preloadThrew, 'preload 对数组不抛错');
    ok(assets.preload('art-preload-c') === undefined,
      'preload 返回 void（bridge 契约，不是 true/false）');
    ok(assets.draw(null, 'art-null-ctx', 0, 0, 8, 8) === false,
      'ctx 为空时 draw 返回 false');

    // 5) 参数防御：非法 id / w/h / 坐标 / opts / 缓存
    var badIds = ['', '../escape', 'bad/id', 'bad id', 'bad.id', 'bad@id',
      'bad\nid', '中文id', 'bad:id', '-leading'];
    var badThrew = false;
    var badAllFalse = true;
    var imagesBeforeBad = fakeImageInstances.length;
    for (var bi = 0; bi < badIds.length; bi++) {
      try {
        if (assets.draw(ctx, badIds[bi], 10, 10, 16, 16) !== false) { badAllFalse = false; }
        assets.preload(badIds[bi]);
        if (assets.ready(badIds[bi]) !== false || assets.get(badIds[bi]) !== null) {
          badAllFalse = false;
        }
      } catch (err) {
        badThrew = true;
      }
    }
    ok(!badThrew && badAllFalse, '空串/路径/空格/点号/特殊字符 id 均被拒绝');
    eq(fakeImageInstances.length, imagesBeforeBad, '非法 id 不创建 Image');

    // 说明：当前 ASSET_ID_RE 带 i 标志，纯大写 id 会被接受；bridge v1 未规定大小写，
    // 这里记录实际行为供运营确认，不作为“拒绝大写”的通过依据。
    var upperDrawn = assets.draw(ctx, 'ArtUpper', 10, 10, 16, 16);
    ok(upperDrawn === true,
      '纯大写 id 当前按大小写不敏感规则可加载（风险点，bridge 未规定）');

    ok(assets.draw(ctx, idOk, 10, 10, 0, 10) === false, 'w=0 时 draw=false');
    ok(assets.draw(ctx, idOk, 10, 10, 10, 0) === false, 'h=0 时 draw=false');
    ok(assets.draw(ctx, idOk, 10, 10, -1, 10) === false, 'w<0 时 draw=false');
    ok(assets.draw(ctx, idOk, NaN, 10, 10, 10) === false, 'x=NaN 时 draw=false');
    ok(assets.draw(ctx, idOk, 10, Infinity, 10, 10) === false, 'y=Infinity 时 draw=false');

    var optsThrew = false;
    var optsDrawn = false;
    try {
      optsDrawn = assets.draw(ctx, idOk, 10, 10, 20, 20, {
        flipX: true, angle: 0.7, anchor: 'bottom', alpha: 0.5, tint: 'flash'
      });
    } catch (err) {
      optsThrew = true;
    }
    ok(!optsThrew && optsDrawn === true,
      'opts flipX/angle/anchor:bottom/alpha/tint 不抛错且可绘制');
    ok(renderSpy.rotate > 0 && renderSpy.scale > 0,
      'angle/flipX 实际走 rotate/scale 变换');

    var instBefore = FakeImage.instancesFor(idOk).length;
    for (var ci = 0; ci < 5; ci++) { assets.draw(ctx, idOk, 10, 10, 16, 16); }
    assets.preload([idOk, idOk, idOk]);
    eq(FakeImage.instancesFor(idOk).length, instBefore, '同 id 重复 draw/preload 不重复创建 Image');

    // 6) 渲染回退桥：同一假 ctx 跑 Combat/Monster/fx 渲染
    var player = world.player;
    var ms = WG.monsters.MonsterSystem;
    var cs = WG.combat.CombatSystem;
    var loot = WG.loot.LootSystem;
    var m1 = ms.spawn('youxia', player.x + 120, player.y, null);
    ok(!!m1, '回退桥：生成游侠');
    if (m1) { m1.speed = 0; m1.baseSpeed = 0; }
    var fired = cs.fire(player, m1, world);
    ok(fired > 0, '回退桥：生成剑气供渲染', 'fired=' + fired);
    var dXp = loot.dropAt(player.x + 40, player.y + 40, 'xp', 6);
    ok(!!dXp, '回退桥：放置经验珠');

    // ready：实际业务 id 均已缓存为可绘制
    var readyIds = ['player', 'monster-wanderer', 'sword-qi', 'drop-xp'];
    var readyAll = true;
    for (var ri = 0; ri < readyIds.length; ri++) {
      if (FakeImage.get(readyIds[ri])) { FakeImage.setDrawable(readyIds[ri], true); }
      if (!assets.ready(readyIds[ri])) { readyAll = false; }
    }
    ok(readyAll, 'render 前 player/monster/sword-qi/drop 素材 ready');

    // 门派武器图层素材：三张图都先加载为可绘制，供映射/回退断言使用
    var weaponIds = ['weapon-sword', 'weapon-blade', 'weapon-needle'];
    var weaponsReady = true;
    for (var wi = 0; wi < weaponIds.length; wi++) {
      FakeImage.setMode(weaponIds[wi], 'success');
      assets.preload(weaponIds[wi]);
      if (FakeImage.get(weaponIds[wi])) { FakeImage.setDrawable(weaponIds[wi], true); }
      if (!assets.ready(weaponIds[wi])) { weaponsReady = false; }
    }
    ok(weaponsReady, 'render 前 weapon-sword/weapon-blade/weapon-needle 素材 ready');

    // 触发 fx 几何效果（剑雨环 + 火花），确保 fx.render 有内容可画
    if (fx.screen && typeof fx.screen.swordRain === 'function') {
      var rain = fx.screen.swordRain(player.x, player.y, 120);
      ok(rain > 0, '回退桥：剑雨特效已生成', 'rain=' + rain);
    }
    if (core.Bus) {
      core.Bus.emit('damage', { x: player.x, y: player.y, amount: 1, crit: false });
    }

    var drawBeforeReady = renderSpy.drawImage;
    var readyThrew = false;
    try {
      cs.render(ctx, 1);
      ms.render(ctx, 1);
      fx.render(ctx, 1, world);
    } catch (err) {
      readyThrew = true;
    }
    ok(!readyThrew, '素材 ready：Combat/Monster/fx.render 均不抛错');
    ok(renderSpy.drawImage > drawBeforeReady,
      '素材 ready：渲染走 ctx.drawImage 贴图路径',
      'drawImage +' + (renderSpy.drawImage - drawBeforeReady));

    // 6b) 门派武器图层：映射 + 针→剑→几何短剑回退（只读；临时替身随后恢复）
    var selection = WG.sects && WG.sects.Selection;
    ok(selection && typeof selection.current === 'function',
      'WG.sects.Selection.current 可用于只读门派判定');
    if (selection && typeof selection.current === 'function') {
      var savedCurrent = selection.current;
      var snapById = function () {
        var copy = Object.create(null);
        for (var key in renderSpy.byId) {
          if (Object.prototype.hasOwnProperty.call(renderSpy.byId, key)) {
            copy[key] = renderSpy.byId[key];
          }
        }
        return copy;
      };
      var deltaId = function (id, snap) {
        return (renderSpy.byId[id] || 0) - (snap[id] || 0);
      };
      var setSect = function (id) {
        selection.current = function () { return id; };
      };
      var renderCombat = function () {
        var threw = false;
        try { cs.render(ctx, 1); } catch (err) { threw = true; }
        return threw;
      };
      try {
        // 剑宗 → weapon-sword（玩家贴图之外再画一层武器）
        FakeImage.setDrawable('weapon-sword', true);
        setSect('jianzong');
        var snapSword = snapById();
        var swordThrew = renderCombat();
        ok(!swordThrew, 'jianzong 渲染不抛错');
        eq(deltaId('weapon-sword', snapSword), 1,
          'jianzong 请求并绘制 weapon-sword');
        eq(deltaId('weapon-needle', snapSword), 0,
          'jianzong 不请求 weapon-needle');
        eq(deltaId('weapon-blade', snapSword), 0,
          'jianzong 不请求 weapon-blade');
        ok(deltaId('player', snapSword) >= 1,
          'jianzong 玩家贴图仍绘制（武器为额外图层）');

        // 道门 → weapon-blade
        FakeImage.setDrawable('weapon-blade', true);
        setSect('daomen');
        var snapBlade = snapById();
        var bladeThrew = renderCombat();
        ok(!bladeThrew, 'daomen 渲染不抛错');
        eq(deltaId('weapon-blade', snapBlade), 1,
          'daomen 请求并绘制 weapon-blade');
        eq(deltaId('weapon-sword', snapBlade), 0,
          'daomen 不请求 weapon-sword');
        eq(deltaId('weapon-needle', snapBlade), 0,
          'daomen 不请求 weapon-needle');

        // 医谷 → weapon-needle
        FakeImage.setDrawable('weapon-needle', true);
        setSect('yigu');
        var snapNeedle = snapById();
        var needleThrew = renderCombat();
        ok(!needleThrew, 'yigu 渲染不抛错');
        eq(deltaId('weapon-needle', snapNeedle), 1,
          'yigu 请求并绘制 weapon-needle');
        eq(deltaId('weapon-sword', snapNeedle), 0,
          'yigu 针可用时不回退 weapon-sword');

        // 医谷且针不可用 → 回退 weapon-sword
        FakeImage.setDrawable('weapon-needle', false);
        FakeImage.setDrawable('weapon-sword', true);
        setSect('yigu');
        var snapNeedleMiss = snapById();
        var needleMissThrew = renderCombat();
        ok(!needleMissThrew, 'yigu 针 missing 渲染不抛错');
        eq(deltaId('weapon-needle', snapNeedleMiss), 0,
          'yigu 针 missing 时不再绘制 weapon-needle');
        eq(deltaId('weapon-sword', snapNeedleMiss), 1,
          'yigu 针 missing 时回退 weapon-sword');
        ok(deltaId('player', snapNeedleMiss) >= 1,
          'yigu 针 missing 时玩家贴图仍绘制');

        // 医谷且针/剑都不可用 → 几何短剑
        FakeImage.setDrawable('weapon-needle', false);
        FakeImage.setDrawable('weapon-sword', false);
        setSect('yigu');
        var snapGeo = snapById();
        var strokeBeforeGeo = renderSpy.stroke;
        var moveBeforeGeo = renderSpy.moveTo;
        var geoThrew = renderCombat();
        ok(!geoThrew, '针/剑都 missing 时渲染不抛错');
        eq(deltaId('weapon-needle', snapGeo), 0,
          '针/剑都 missing 时不绘制 weapon-needle');
        eq(deltaId('weapon-sword', snapGeo), 0,
          '针/剑都 missing 时不绘制 weapon-sword');
        ok(deltaId('player', snapGeo) >= 1,
          '针/剑都 missing 时玩家贴图仍绘制');
        ok(renderSpy.stroke > strokeBeforeGeo ||
          renderSpy.moveTo > moveBeforeGeo,
          '针/剑都 missing 时走几何短剑回退（stroke/moveTo 增加）',
          'stroke+' + (renderSpy.stroke - strokeBeforeGeo) +
          ', moveTo+' + (renderSpy.moveTo - moveBeforeGeo));
      } finally {
        selection.current = savedCurrent;
        for (var wri = 0; wri < weaponIds.length; wri++) {
          if (FakeImage.get(weaponIds[wri])) {
            FakeImage.setDrawable(weaponIds[wri], true);
          }
        }
      }
    }

    // missing：弓手/刀客是首次加载且强制两级失败；其余实际 id 置为不可绘制
    FakeImage.setMode('monster-bowman', 'fail');
    FakeImage.setMode('monster-blade', 'fail');
    var m2 = ms.spawn('archer', player.x - 120, player.y, null);
    var m3 = ms.spawn('daoke', player.x, player.y + 120, null);
    ok(!!m2 && !!m3, '回退桥：生成弓手/刀客（素材强制 missing）');
    if (m2) { m2.speed = 0; m2.baseSpeed = 0; }
    if (m3) { m3.speed = 0; m3.baseSpeed = 0; }
    if (FakeImage.get('drop-potion')) { FakeImage.setDrawable('drop-potion', false); }
    else { FakeImage.setMode('drop-potion', 'fail'); }
    var dPotion = loot.dropAt(player.x - 40, player.y + 40, 'potion');
    ok(!!dPotion, '回退桥：放置疗伤丹（素材强制 missing）');

    var missingIds = ['player', 'monster-wanderer', 'sword-qi', 'drop-xp', 'drop-silver',
      'weapon-sword', 'weapon-blade', 'weapon-needle'];
    for (var mi = 0; mi < missingIds.length; mi++) {
      if (FakeImage.get(missingIds[mi])) { FakeImage.setDrawable(missingIds[mi], false); }
    }
    // 项目内已有弓手/刀客的 Image 时也置为不可绘制；首次加载的走 missing 状态
    if (FakeImage.get('monster-bowman')) { FakeImage.setDrawable('monster-bowman', false); }
    if (FakeImage.get('monster-blade')) { FakeImage.setDrawable('monster-blade', false); }

    var drawBeforeMissing = renderSpy.drawImage;
    var arcBeforeMissing = renderSpy.arc;
    var fillBeforeMissing = renderSpy.fill;
    var missingThrew = false;
    try {
      cs.render(ctx, 1);
      ms.render(ctx, 1);
      fx.render(ctx, 1, world);
      loot.render(ctx, 0.5);
    } catch (err) {
      missingThrew = true;
    }
    ok(!missingThrew, '素材 missing：Combat/Monster/fx.render 均不抛错');
    eq(renderSpy.drawImage, drawBeforeMissing,
      '素材 missing：不再调用 ctx.drawImage');
    ok(renderSpy.arc > arcBeforeMissing || renderSpy.fill > fillBeforeMissing,
      '素材 missing：几何回退路径仍执行（arc/fill 增加）',
      'arc+' + (renderSpy.arc - arcBeforeMissing) + ', fill+' + (renderSpy.fill - fillBeforeMissing));
    ok(assets.ready('weapon-sword') === false &&
      assets.ready('weapon-blade') === false &&
      assets.ready('weapon-needle') === false,
      '素材 missing：weapon-sword/weapon-blade/weapon-needle 均不可绘制');
    ok(assets.ready('monster-bowman') === false,
      '弓手素材两级失败后 ready=false（真实 missing 路径）');
    ok(assets.ready('monster-blade') === false,
      '刀客素材两级失败后 ready=false（真实 missing 路径）');

    // 恢复可绘制，避免影响后续对局渲染（弓手/刀客保持 missing 以验证回退不崩）
    var restoreIds = ['player', 'monster-wanderer', 'sword-qi', 'drop-xp', 'drop-silver', 'drop-potion',
      'weapon-sword', 'weapon-blade', 'weapon-needle'];
    for (var si = 0; si < restoreIds.length; si++) {
      if (FakeImage.get(restoreIds[si])) { FakeImage.setDrawable(restoreIds[si], true); }
    }
  });

  /* ---------- 14.5) 静态资源约束：27 defer / 无远程 URL / 无 tools/art 引用 ---------- */

  phase('静态资源约束', function () {
    var tags = indexHtml.match(/<script\b[^>]*>/g) || [];
    var externalTags = 0;
    var inlineTags = 0;
    var allDefer = true;
    for (var t = 0; t < tags.length; t++) {
      var tag = tags[t];
      if (/\bsrc\s*=/.test(tag)) {
        externalTags++;
        if (!/\bdefer\b/.test(tag)) { allDefer = false; }
      } else {
        inlineTags++;
      }
    }
    eq(externalTags, SRC_ORDER.length + 1,
      'index.html 恰有 27 个外链 script（26 src + tests/perf.js）');
    eq(inlineTags, 0, 'index.html 无内联 script');
    ok(allDefer, 'index.html 的 27 个外链 script 全部带 defer');
    eq(actualOrder.length, SRC_ORDER.length + 1,
      '实际解析出的脚本数为 27');
    eq(actualOrder[SRC_ORDER.length], PERF_SCRIPT,
      '第 27 个脚本仍为 tests/perf.js（顺序未变）');
    ok(actualOrder.length === LOAD_ORDER.length,
      '实际脚本数等于 26 src + perf 的加载顺序长度');

    var srcFiles = [];
    (function walk(rel) {
      var abs = path.join(root, rel);
      var names = fs.readdirSync(abs);
      for (var i = 0; i < names.length; i++) {
        var childRel = rel + '/' + names[i];
        var childAbs = path.join(root, childRel);
        var st = fs.statSync(childAbs);
        if (st.isDirectory()) { walk(childRel); }
        else { srcFiles.push(childRel); }
      }
    })('src');

    var remoteHits = [];
    var toolsHits = [];
    var scanTargets = srcFiles.concat(['index.html']);
    for (var f = 0; f < scanTargets.length; f++) {
      var text = fs.readFileSync(path.join(root, scanTargets[f]), 'utf8');
      if (/https?:\/\//i.test(text)) { remoteHits.push(scanTargets[f]); }
      if (/tools[\\/]art[\\/]/.test(text)) { toolsHits.push(scanTargets[f]); }
    }
    ok(remoteHits.length === 0,
      'index.html 与 src/** 无 http(s) 远程 URL', remoteHits.join(', '));
    ok(toolsHits.length === 0,
      'index.html 与 src/** 无 tools/art/ 引用', toolsHits.join(', '));
    ok(srcFiles.length > 0, '静态扫描覆盖 src/** 全部脚本',
      'files=' + srcFiles.length);
  });
};
