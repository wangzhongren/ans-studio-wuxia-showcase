# assets/ · 占位素材目录（env-resources · 属主 env-bootstrap）

> 契约依据：`docs/contracts/wuxia-rogue-architecture-v1.md` §3.1。
> 本目录只允许**自绘 / 程序化生成**的占位素材，不得引入任何第三方版权素材。

## 1. 版权与来源声明

- 本目录全部文件由本项目手写 SVG 图形构成（基础几何：`rect` / `circle` / `path` / 本地渐变）。
- **无第三方素材**：未使用任何图库、图标集、字体文件、贴图或联网资源。
- **零网络依赖**：SVG 内不含外部 `href`、`@import`、`@font-face` 或远程 URL；不依赖系统字体（图形内无 `<text>`）。
- 用途仅为原型阶段的视觉占位，可在不改契约的前提下替换为本项目自绘的正式素材。

## 2. 文件清单

| 文件 | 画布尺寸 | 用途 | 对应表现层概念 |
| --- | --- | --- | --- |
| `placeholder-player.svg` | 64×64 | 玩家侠客占位 | `WG.combat.Player` |
| `placeholder-monster.svg` | 48×48 | 怪物（游侠）占位 | `WG.monsters` |
| `placeholder-sword-qi.svg` | 48×16 | 自动攻击剑气占位（仅占位，不在 17 项生成清单） | `WG.combat.CombatSystem` |
| `placeholder-drop-xp.svg` | 24×24 | 经验珠占位 | `WG.loot`（经验） |
| `placeholder-drop-silver.svg` | 24×24 | 银两占位 | `WG.loot`（银两） |
| `placeholder-drop-potion.svg` | 24×24 | 疗伤丹（葫芦）占位 | `WG.loot`（回血） |
| `placeholder-ground-tile.svg` | 128×128 | 无缝地面纹理占位 | 地图底纹（程序生成世界的可选底图） |
| `placeholder-title-bg.svg` | 1280×720 | 标题界面夜色水墨底（标题区留白） | 标题层背景 |
| `placeholder-sect-jianzong.svg` | 256×384 | 剑宗竖幅卷轴（青玉主色 / 剑符号） | 门派选择 |
| `placeholder-sect-daomen.svg` | 256×384 | 刀门竖幅卷轴（赤金主色 / 大刀符号） | 门派选择 |
| `placeholder-sect-yigu.svg` | 256×384 | 医谷竖幅卷轴（药绿主色 / 葫芦草药符号） | 门派选择 |
| `placeholder-monster-wanderer.svg` | 96×96 | 游侠怪物（短剑，朝右，便于水平翻转） | 怪物表现 |
| `placeholder-monster-bowman.svg` | 96×96 | 弓手怪物（弓与箭，朝右，便于水平翻转） | 怪物表现 |
| `placeholder-monster-blade.svg` | 96×96 | 刀客怪物（大刀，朝右，便于水平翻转） | 怪物表现 |
| `placeholder-weapon-sword.svg` | 96×96 | 剑宗直剑武器叠加层（透明背景，竖向居中、剑尖朝上） | 玩家持械 / 攻击 |
| `placeholder-weapon-blade.svg` | 96×96 | 刀门弯刀武器叠加层（透明背景，斜向居中、刀尖朝上） | 玩家持械 / 攻击 |
| `placeholder-weapon-needle.svg` | 96×96 | 医谷细针武器叠加层（透明背景，竖向居中、针尖朝上） | 玩家持械 / 攻击 |
| `placeholder-ui-scroll.svg` | 1024×512 | 旧卷轴界面框占位；已生成 `ui-scroll.webp` 保留不用（升级三选一为透明无背景） | 门派覆盖层现用 `ui-stele` |
| `placeholder-ui-stele.svg` | 1024×512 | 石碑界面框（中央留白供 DOM 内容） | 选项石碑覆盖层 |
| `placeholder-ui-result.svg` | 1280×720 | 结算界面夜色底（中央留白供结算数据） | 结算层背景 |

### 使用约定

- 文件路径以项目根为基准：`assets/placeholder-*.svg`。
- Canvas 侧可选方案：启动时用 `new Image()` 加载到离屏 canvas 做预渲染，运行时单次 `drawImage`；**加载失败也必须能降级为代码内几何绘制**，不得因此阻断启动。
- `placeholder-ground-tile.svg` 已保证所有图形完全落在视口内，可 `createPattern(..., 'repeat')` 无缝平铺。
- 本目录素材为**可选增强**：`src/` 任何模块不加载它们时，游戏仍应完整可玩。

### 美术回退链（17 项资产 + 剑气）

> 口径：**17 项生成 WebP；其中 16 项运行时引用**，`ui-scroll` 保留不用（客户要求升级三选一透明、无背景；门派覆盖层使用 `ui-stele`）。`sword-qi` 仅占位 `assets/placeholder-sword-qi.svg` + 几何回退，**不在 17 项生成清单，非生成资产**。

运行时优先加载 `assets/generated/<id>.webp`；缺失或解码失败时回退到 `assets/placeholder-<id>.svg`；再失败则降级为代码内几何 / CSS 占位。任一环节失败必须静默降级，不得阻断启动。

| 资产 id | 占位文件 |
| --- | --- |
| `title-bg` | `assets/placeholder-title-bg.svg` |
| `sect-jianzong` | `assets/placeholder-sect-jianzong.svg` |
| `sect-daomen` | `assets/placeholder-sect-daomen.svg` |
| `sect-yigu` | `assets/placeholder-sect-yigu.svg` |
| `monster-wanderer` | `assets/placeholder-monster-wanderer.svg` |
| `monster-bowman` | `assets/placeholder-monster-bowman.svg` |
| `monster-blade` | `assets/placeholder-monster-blade.svg` |
| `player` | `assets/placeholder-player.svg` |
| `weapon-sword` | `assets/placeholder-weapon-sword.svg` |
| `weapon-blade` | `assets/placeholder-weapon-blade.svg` |
| `weapon-needle` | `assets/placeholder-weapon-needle.svg` |
| `ui-scroll` | `assets/placeholder-ui-scroll.svg` |
| `ui-stele` | `assets/placeholder-ui-stele.svg` |
| `ui-result` | `assets/placeholder-ui-result.svg` |
| `ground-tile` | `assets/placeholder-ground-tile.svg` |
| `drop-xp` | `assets/placeholder-drop-xp.svg` |
| `drop-silver` | `assets/placeholder-drop-silver.svg` |
| `drop-potion` | `assets/placeholder-drop-potion.svg` |
| `sword-qi` | `assets/placeholder-sword-qi.svg` |

> `ground-tile` 为可选地面纹理，不属于 MANIFEST 的 17 项资产；保留供地图底纹使用。

### 增删规则

- 新增文件须沿用 `placeholder-<用途>.svg` 命名，并在上表登记。
- 禁止放入：位图照片、字体文件、音视频、第三方图标、压缩包或任何来源不明的二进制文件。
- 禁止用联网 CDN 链接替代本地文件。

## 3. HUD DOM 样式约定（与 `styles/theme.css` 对齐）

`styles/theme.css` 已为 HUD 与界面层提供类名钩子；`src/ui/`（属主 presentation-fx）按下列约定渲染即可自动继承主题，**不得在 JS 内写死颜色/字号**。

```html
<!-- 画布（entry-index 提供） -->
<canvas id="game"></canvas>

<!-- HUD 覆盖层（WG.ui.hud 填充） -->
<div id="hud" class="hud">
  <div class="hud__top">
    <div class="hud-panel">
      <span class="hud-label">时间</span>
      <span class="hud-timer">08:00</span>
    </div>
    <div class="hud-panel">
      <div class="hud-row"><span>等级</span><span class="hud-value hud-value--accent">1</span></div>
      <div class="hud-bar hud-bar--xp"><span class="hud-bar__fill" style="--hud-bar-fill: 0%"></span></div>
    </div>
  </div>

  <div class="hud__bottom">
    <div class="hud-panel hud-panel--plain">
      <div class="hud-row"><span>气血</span><span class="hud-value hud-value--danger">100</span></div>
      <div class="hud-bar hud-bar--hp"><span class="hud-bar__fill" style="--hud-bar-fill: 100%"></span></div>
    </div>
    <div class="hud__corner">
      <span class="hud-chip">击杀 <span class="hud-chip__value">0</span></span>
      <span class="hud-chip hud-chip--silver">银两 <span class="hud-chip__value">0</span></span>
    </div>
  </div>

  <div class="hud-debug" hidden></div>
</div>

<!-- 标题 / 结算层（WG.ui.screens 填充） -->
<div id="screens" class="screens"></div>
```

### 关键类名与变量

| 类名 / 变量 | 说明 |
| --- | --- |
| `.hud` / `#hud` | 全屏覆盖层，`pointer-events: none`，不挡鼠标 |
| `.hud__top` / `.hud__bottom` / `.hud__corner` | 绝对定位角落容器 |
| `.hud-panel` / `.hud-panel--plain` | 半透明面板（背景、描边、圆角、阴影均取变量） |
| `.hud-label` / `.hud-value` / `.hud-unit` | 标签 / 数值 / 单位 |
| `.hud-row` | 一行「标签 + 数值」 |
| `.hud-bar` + `.hud-bar--hp` / `--xp` / `--cooldown` | 状态条；填充宽度由 `--hud-bar-fill` 控制（如 `style="--hud-bar-fill: 62%"`） |
| `.hud-chip` + `.hud-chip--silver` / `--hp` | 计数胶囊 |
| `.hud-debug` | F3 调试面板（`WG.perf.overlay` 填充，等宽字体） |
| `.screens` + `.is-active` | 标题 / 结算遮罩；激活时自动接收指针事件 |
| `.screen` / `.screen__title` / `.screen__stats` / `.btn` | 界面内容块与按钮 |
| `--hud-scale` | HUD 整体缩放因子（窗口窄时 CSS 自动下调） |
| `--color-*` | 配色令牌；Canvas 可用 `getComputedStyle` 读取保持画面与 HUD 一致 |

> 语义色：`--color-hp`（赤血）、`--color-xp`（青玉）、`--color-gold`（鎏金标题）、`--color-silver`（银两）、`--color-sword-300`（剑气青光）。
> 字体：`--font-display`（标题，宋/楷系统字体）、`--font-ui`（HUD 正文）、`--font-mono`（调试数值），全部系统本地字体，无 `@font-face`。

## 4. 自测清单（本目录）

- [x] 全部为手写 SVG，无外部引用、无 `<text>`、无网络 URL。
- [x] 20 个占位 SVG，覆盖 MANIFEST 17 项资产 + `sword-qi` 的本地回退（含 3 个透明背景武器叠加层，见上表映射）。
- [x] 尺寸与上表一致，`viewBox` 与 `width/height` 匹配。
- [x] 地面纹理可无缝平铺（装饰元素不跨边界）。
- [x] 不加载本目录素材时，项目仍可运行（素材为可选增强）。
