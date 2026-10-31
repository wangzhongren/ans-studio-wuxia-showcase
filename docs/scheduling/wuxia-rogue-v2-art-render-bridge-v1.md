# v2 美术渲染与特效接入约定（bridge v1）

> 运营（convener）落盘的跨模块实现约定，供本轮「人物/敌人无美术、攻击无特效」修复派发使用。
> 背景：客户实机反馈人物/敌人无图像、攻击特效不足；排查确认 `src/` 无任何 `drawImage`，7 个占位 SVG 未被引用，`assets/generated/` 仅 `SOURCES.md`。本轮先用占位 SVG 达成「可辨认图像 + 明确攻击/受击/死亡表现」，生成素材落盘后同路径自动替换，无需改代码。
> 契约基线：`docs/contracts/wuxia-rogue-v2-architecture-v1.md`（sha256 `d4bec46b8d05157563b1da2bc2462c8a3a86d2fe5ebfe9e1519e49656715c152`）。本约定只补充**运行时图片加载与表现**，不改事件名、不改玩法数值、不新增脚本。

## 1. 硬约束

1. **不新增脚本**：`index.html` 保持 26 个契约脚本 + `tests/perf.js`（共 27），顺序不变；加载器写入现有 `src/fx/` 文件。
2. **零运行时依赖、不联网**：只用本地 `assets/` 文件；不得出现远程 URL；不得引用 `tools/art/`。
3. **加载失败不报错、不阻塞**：缺图时静默回退；`onerror` 不得抛异常、不得中断渲染循环、不得写 `console.error`（可 `warn` 一次或静默）。
4. **模块边界**：各角色只改自己模块；跨模块只读 `WG.*` 公开接口与 `Bus` 事件；**不得修改 `tests/`（归 core-engine）**、不得改 `index.html`（归 env-bootstrap）。
5. **性能**：沿用冻结的固定容量对象池；不得逐帧/逐事件新建对象（`draw` 调用参数直接传数字，不建临时对象）；离屏剔除；不改变既有 F3 统计口径。
6. **降级**：`WG.fx.degrade.enabled` 为 true 时，新增装饰性特效应关闭或降为最简（伤害数字保留）。

## 2. 资产 id 与路径（唯一真源：`tools/art/MANIFEST.json` / `assets/generated/SOURCES.md`）

| id | 生成素材（优先） | 占位素材（回退） | 用途 |
| --- | --- | --- | --- |
| title-bg | `assets/generated/title-bg.webp` | `assets/placeholder-title-bg.svg` | 开始页背景（DOM） |
| player | `assets/generated/player.webp` | `assets/placeholder-player.svg` | 玩家（canvas） |
| weapon-sword | `assets/generated/weapon-sword.webp` | `assets/placeholder-weapon-sword.svg` | 剑宗持械/攻击（canvas，随玩家朝向） |
| weapon-blade | `assets/generated/weapon-blade.webp` | `assets/placeholder-weapon-blade.svg` | 刀门持械/攻击（canvas，随玩家朝向） |
| weapon-needle | `assets/generated/weapon-needle.webp` | `assets/placeholder-weapon-needle.svg` | 医谷针/药杵（canvas；可缺，缺则回退剑） |
| sect-jianzong | `assets/generated/sect-jianzong.webp` | `assets/placeholder-sect-jianzong.svg` | 剑宗卷轴（DOM） |
| sect-daomen | `assets/generated/sect-daomen.webp` | `assets/placeholder-sect-daomen.svg` | 刀门卷轴（DOM） |
| sect-yigu | `assets/generated/sect-yigu.webp` | `assets/placeholder-sect-yigu.svg` | 医谷卷轴（DOM） |
| monster-wanderer | `assets/generated/monster-wanderer.webp` | `assets/placeholder-monster-wanderer.svg` | 游侠（canvas） |
| monster-bowman | `assets/generated/monster-bowman.webp` | `assets/placeholder-monster-bowman.svg` | 弓手（canvas） |
| monster-blade | `assets/generated/monster-blade.webp` | `assets/placeholder-monster-blade.svg` | 刀客/血刀宗师（canvas） |
| ui-scroll | `assets/generated/ui-scroll.webp` | `assets/placeholder-ui-scroll.svg` | 已生成、**保留不用**（升级三选一透明无背景；门派覆盖层使用 ui-stele；运行时零引用） |
| ui-stele | `assets/generated/ui-stele.webp` | `assets/placeholder-ui-stele.svg` | 石碑覆盖层（DOM） |
| ui-result | `assets/generated/ui-result.webp` | `assets/placeholder-ui-result.svg` | 结算页背景（DOM） |
| drop-xp | `assets/generated/drop-xp.webp` | `assets/placeholder-drop-xp.svg` | 经验珠（canvas） |
| drop-silver | `assets/generated/drop-silver.webp` | `assets/placeholder-drop-silver.svg` | 银两（canvas） |
| drop-potion | `assets/generated/drop-potion.webp` | `assets/placeholder-drop-potion.svg` | 疗伤丹（canvas） |
| sword-qi（运行时专用） | 无（**不在 17 项生成清单内，仅占位**） | `assets/placeholder-sword-qi.svg` | 剑气/弹道贴图（canvas） |

说明：`sword-qi` 仅用于运行时弹道贴图；生成链里没有它时直接落到占位 SVG，视为正常。怪物类型映射：`youxia→monster-wanderer`、`archer→monster-bowman`、`daoke→monster-blade`、`bloodmaster→monster-blade`（精英/宗师用金色描边或尺寸放大区分，**精英变体复用基础素材，不新增 id**；若后续需要独立立绘再走需求变更）。

武器映射（玩家持械）：门派 `jianzong→weapon-sword`、`daomen→weapon-blade`、`yigu→weapon-needle`（`weapon-needle` 可缺；缺失或加载失败时回退 `weapon-sword`，再回退现有几何短剑）。武器图层只读门派选择与朝向，不写玩法状态。

## 3. 共享加载器接口（由 presentation-fx 实现，写入现有 `src/fx/` 文件，不新增脚本）

公开：`WG.fx.assets`

```text
draw(ctx, id, x, y, w, h, opts) -> boolean
  - 已加载可绘制时返回 true；不可用（未就绪/失败/无 ctx/无 drawImage）返回 false，调用方回退几何绘制。
  - ctx 变换由调用方负责（main 已在相机变换后调用 render）；本函数只按世界坐标绘制。
  - opts（可选，字段均可缺省；调用方不得为此新建对象，可用模块级复用对象）：
      flipX: boolean   水平翻转（朝向）
      alpha: number    0..1，绘制透明度
      angle: number    旋转弧度（弹道）
      anchor: 'center' | 'bottom'（默认 center；bottom 表示 y 为脚底）
      tint: 'flash'    受击闪白（可用叠加白色圆/高亮近似，不要求改像素）
get(id) -> 可绘制对象|null
ready(id) -> boolean
preload(idOrIds) -> void（预加载，绝不抛异常）
```

加载链规则：

1. 首次访问某 id 时创建 `Image`（`typeof Image === 'function'` 才创建；Node/无 DOM 环境直接返回 null）。
2. 先设 `src=assets/generated/<id>.webp`；`onerror` 时**只切换一次**到 `assets/placeholder-<id>.svg`；再次失败标记 `missing` 并停止重试。
3. 只有 `complete && naturalWidth > 0` 才可绘制；`drawImage` 不存在或抛异常时安全返回 false。
4. 同一 id 复用同一个 `Image`，不重复创建；不复位/不重载。
5. 图片绘制不改变 `ctx.globalAlpha` 之外的任何调用方状态需自行 save/restore；建议加载器内部保存/恢复 alpha 与变换。

## 4. 各模块接入点（按属主）

| 模块 | 属主 | 接入 |
| --- | --- | --- |
| visual-fx `src/fx/` | presentation-fx | 实现 `WG.fx.assets`；`damage` 命中火花（固定槽位或粒子池，≤6 颗）；`monster:killed` 碎裂/消散环（预分配槽位）；保持既有回旋/裂空/剑雨轮廓；降级关闭装饰 |
| hud-ui `src/ui/` | presentation-fx | `screens.js`/`overlays.js` 的 `addImage`：generated → placeholder → 移除节点，二次 error 才移除；覆盖 title-bg、3 门派、ui-result、ui-stele；choice 已无背景图，**ui-scroll 不再请求** |
| combat-player `src/combat/` | combat-player | 玩家贴图（flipX=朝向，缺图回退现几何）；武器图层按门派选 `weapon-sword`/`weapon-blade`/`weapon-needle`（`weapon-needle` 缺省回退 `weapon-sword`，再回退几何短剑），按 `facingX` 翻转、不写玩法状态；剑气贴图 `sword-qi`（按 `p.angle` 旋转）+ 短拖尾（3 段，不新建对象）；命中反馈由 fx 订阅 `damage` 统一做，combat 不改事件 |
| monsters-waves `src/monsters/` | monsters-director | 按 type 贴图 + 朝向翻转；`m.flash>0` 时叠白色受击闪光（图片路径也可见）；箭矢可用 `sword-qi` 或保留几何；精英金色描边保留 |
| loot-progression `src/loot/` | loot-progression | 三种掉落贴图（drop-xp/drop-silver/drop-potion），保留弹出/磁吸/高光；缺图回退现几何 |
| env-resources `assets/` | env-bootstrap | 新增缺失的占位 SVG（见 §5），保证每个 id 都有占位；不得改运行时脚本 |
| perf-harness `tests/` | core-engine | 集成测试补：假 Image/drawImage 记录、加载链（generated→placeholder）、缺图回退不抛错、27 脚本顺序不变；保持 489+ 全绿 |

## 5. env-bootstrap 需补的占位文件（已存在的保持不动）

已存在：`placeholder-player.svg`、`placeholder-monster.svg`、`placeholder-drop-xp.svg`、`placeholder-drop-silver.svg`、`placeholder-drop-potion.svg`、`placeholder-ground-tile.svg`、`placeholder-sword-qi.svg`。

需新增（10 个，已完成）：`placeholder-title-bg.svg`、`placeholder-sect-jianzong.svg`、`placeholder-sect-daomen.svg`、`placeholder-sect-yigu.svg`、`placeholder-monster-wanderer.svg`、`placeholder-monster-bowman.svg`、`placeholder-monster-blade.svg`、`placeholder-ui-scroll.svg`、`placeholder-ui-stele.svg`、`placeholder-ui-result.svg`。

客户新增反馈（2026-10-31）需补武器占位（3 个）：`placeholder-weapon-sword.svg`、`placeholder-weapon-blade.svg`、`placeholder-weapon-needle.svg`；生成素材落盘后同 id 自动优先。

要求：SVG 自绘、无外部引用、体积小（单文件 < 50 KB）、可辨认轮廓；玩家/怪物需有朝向可辨的武器或体态；三门派可用不同主色/符号区分。生成素材落盘后同 id 自动优先，无需改代码。

## 6. 验收口径（本轮）

1. 真实浏览器打开 `index.html`：人物、三类敌人、掉落物、剑气有图像（占位图即可辨认）；标题/门派/结算 DOM 图有回退。
2. 攻击：剑气有可见拖尾；命中有点击火花/受击闪白；击杀有碎裂/消散；范围技能轮廓清晰。
3. 断网、缺图、`file://` 下均不报错、不阻塞启动；F3 性能详表不退化。
4. `node tests/integration-check.js` 全绿（core-engine 更新后的断言）；`node tests/bench.js` p95 在预算内。
5. AC-9~AC-13 的最终目视判定由质检/客户在真实浏览器完成；运营不代验收。

## 7. 2026-10-31 客户追加反馈约定（透明三选一 + 正式素材）

### 7.1 升级三选一透明弹层（S12/AC-12）

- 仅改 `showChoice` 路径（`src/ui/overlays.js`）；`showSect` 门派覆盖层保持现状（含 ui-stele 背景）。
- 移除 choice 覆盖层的背景图引用（不得再请求/绘制 `ui-scroll`）；不得新增任何图片背景。`ui-scroll.webp` 虽保留在 `assets/generated/`，但运行时零引用（质检终验 F1 已确认）。
- 覆盖层外层不得有大面积不透明底板：wrapper 背景透明、无模糊遮罩；如需可读性，最多 ≤10% 暗度或文字细描边/阴影。
- 选项卡片（`.stele-option`）自身可保留半透明暗底与描边，但不得改成卡牌样式、不得引入抽选/收集命名；必须仍恰好 3 项、未选择不自动选、选择后立即生效。
- 验收观察点：升级暂停时，游戏画面/场景应透出；文字清晰可读；Console 无错误。

### 7.2 正式素材（S13/AC-13 增补）

- 生成项：`player`、`monster-wanderer`、`monster-bowman`、`monster-blade`、`weapon-sword`、`weapon-blade`、`weapon-needle`（共 7 项，前 4 项为既有失败项重试，后 3 项为新增）。
- 武器素材统一为**正方形 96×96、透明/近透明背景、武器居中（竖向或斜向）**，与 `tools/art/prompts/weapon-*.md` 的 96×96 口径及 combat 的方形绘制盒一致；占位 SVG 也必须为 96×96，避免被 `draw(ctx,id,x,y,w,h)` 拉伸变形。
- `tools/art/prompts/` 新增 3 份武器提示词；`MANIFEST.json` 逐项登记（成功写 `ok` 与实际文件，失败写 `failed` + 真实原因，不得虚报）。
- 生成成功后由 env-bootstrap 转 WebP 落 `assets/generated/`，更新 `assets/generated/SOURCES.md`（逐项成功/失败/占位）。
- 缺依赖时：保留/新增占位 SVG，代码引用不变；报告如实写「依赖缺失、未生成」，不得声称已替换。
- 运行时只引用 `assets/generated/`，零模型依赖、无远程 URL。

## 8. 素材引用口径（质检终验 F1/F2 后校正，2026-10-31）

- 准确口径：**17 项生成 WebP；16 项运行时引用；`ui-scroll` 保留不用**（客户要求升级三选一透明、无背景；门派覆盖层用 `ui-stele`）。`assets/generated/ui-scroll.webp` 仍在目录中且与 SOURCES 一致，但 `src/`、`index.html`、`styles/theme.css` 检索命中 0，不参与运行时。
- `sword-qi`：不在 17 项 MANIFEST/prompts 生成清单内，仅 `assets/placeholder-sword-qi.svg` + 几何回退；不按「已生成资产」表述。
- 本文件前文若出现「三选一/通用覆盖层（ui-scroll）」等旧描述，以本节为准；任何「17 项全部运行时引用/全部接入」的说法均不成立。
- 验收边界：真实浏览器目视由质检/客户完成，运营不代判。
