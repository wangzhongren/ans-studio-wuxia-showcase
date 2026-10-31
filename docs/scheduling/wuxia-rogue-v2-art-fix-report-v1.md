# 实机反馈修复报告 v1 · 人物/敌人美术与攻击特效

> 来源任务：幕僚 #t-mvwa30nn-67bfa9aa（客户实机反馈「人物和敌人，还有攻击也没有特效」）
> 修复依据：`docs/scheduling/wuxia-rogue-v2-art-render-bridge-v1.md`（跨模块桥接约定）
> 编制：运营（convener）｜2026-10-31
> 状态：实现与回归已完成；**真实浏览器目视/帧率尚未由运营实测**，需质检/客户复验。
>
> **历史说明（2026-10-31 后续变更，以最新记录为准）**：本报告反映第一次修复时的状态。此后客户要求升级三选一弹层透明无背景，`src/ui` 的 choice 覆盖层已不再请求/绘制 `ui-scroll`（门派覆盖层继续用 `ui-stele`）；§2 表格中「overlay 背景 ui-scroll/ui-stele」与 §5 第 4 条为当时描述。正式美术已由 art-generator 生成 17 项（MANIFEST 17/17 ok），WebP 为 10 精灵透明 + 7 背景不透明；运行时引用为 **16/17**，`ui-scroll.webp` 生成后保留不用；`sword-qi` 不在 17 项生成清单内、仅占位。§4 的 551/0 与 §5 第 2 条的「14 项 failed」均为历史值，最新基线 integration 575/0。详见 `wuxia-rogue-v2-feedback2-verify-v1.md` §5、§8。

## 1. 根因

v2 交付时只有几何绘制：`src/**` 中没有任何 `drawImage`，`assets/generated/` 内的素材从未被引用；`src/ui` 的 DOM 图片只在加载失败时直接移除节点。因此实机表现为纯圆形/菱形几何体，攻击只有线条，没有人物、敌人、掉落物与命中特效。

## 2. 修复内容（按模块属主）

| 属主 | 模块 / 文件 | 改动 |
| --- | --- | --- |
| presentation-fx | visual-fx / `src/fx/screen-fx.js` | 新增共享加载器 `WG.fx.assets`：`draw/get/ready/preload`；同 id 单 Image 缓存（上限 64）；加载链 generated webp → placeholder svg → missing，全程静默、失败返回 false；无 `Image`/无 `ctx.drawImage` 安全降级；`opts` 支持 flipX/alpha/angle/anchor('center'|'bottom')/tint:'flash'。新增 damage 命中火花（32 槽）与 monster:killed 碎裂/消散环（16 槽），均环形复用；降级时关闭。 |
| presentation-fx | hud-ui / `src/ui/screens.js`、`src/ui/overlays.js` | `addImage` 改为单 `error` 监听器：首次失败仅切一次 `assets/placeholder-<id>.svg`，二次失败静默移除；覆盖 title-bg、ui-result、门派卷轴图、overlay 背景 ui-scroll/ui-stele、带路径选项图标。 |
| combat-player | combat-player / `src/combat/auto-attack.js` | 玩家渲染优先 `assets.draw(ctx,'player',…,{flipX})`，失败回退原几何；剑气优先 `sword-qi`（按角度旋转），失败回退菱形；新增 3 段半透明拖尾（降级时关闭）；每帧只解析一次 assets/degrade。 |
| monsters-director | monsters-waves / `src/monsters/ai.js` | 类型映射 youxia→monster-wanderer、archer→monster-bowman、daoke/bloodmaster→monster-blade；尺寸 m.r×3（bloodmaster×1.15）；受击闪白在贴图/几何两路径均生效；敌方箭矢用 `sword-qi` 并按速度角旋转，失败回退白圆。 |
| loot-progression | loot-progression / `src/loot/pickup.js` | xp/silver/potion 分别接入 drop-xp/drop-silver/drop-potion（尺寸 ×3.2），磁吸环先画；draw 失败回退原几何。 |
| env-bootstrap | env-resources / `assets/` | 新增 10 个自绘 SVG 占位：title-bg、sect-jianzong/daomen/yigu、monster-wanderer/bowman/blade、ui-scroll/ui-stele/ui-result；连同既有 7 个共 17 个占位；既有 7 个哈希未变。 |
| core-engine | perf-harness / `tests/` | 新增 `tests/art-render-check.js`（由 integration-check 注册）：假 Image 可控加载链、占位回退、两级失败、无 Image/drawImage、参数防御、缓存唯一性、Combat/Monster/fx 渲染回退桥；静态约束 27 defer、无远程 URL、无 tools/art 引用。 |

## 3. 加载与回退契约（摘要）

- 路径：`assets/generated/<id>.webp` → 失败一次 `assets/placeholder-<id>.svg` → 仍失败 missing；不重试、不抛错。
- 缓存：同 id 只创建一个 Image；超过 64 个 id 后不再新建（返回 false）。
- 绘制：`draw` 返回 boolean；`w/h<=0`、NaN/Infinity 坐标、非法 id 一律 false；`get` 仅在 ready 时返回 Image；`ready` 即 `get != null`。
- 安全：无 `Image` 构造器、无 `ctx.drawImage`、drawImage 抛异常时均返回 false，调用方回退几何。
- 装饰：火花/消散/拖尾受 `WG.fx.degrade.enabled` 控制；贴图与几何在主路径不受影响。

## 4. 回归结果（本轮实测）

| 命令 | 结果 |
| --- | --- |
| `node tests/integration-check.js --failures` | **551 passed, 0 failed**（基线 489/0；新增「美术加载链与渲染回退桥」「静态资源约束」两节 62 项） |
| `node tests/smoke-core.js` | 76 passed / 0 failed |
| `node tests/perf-check.js` | 52 passed / 0 failed |
| `node tests/background-check.js` | 31 passed / 0 failed |
| `node tests/loop-check.js` | 15 passed / 0 failed |
| `node tests/perf-integration-check.js` | 16 passed / 0 failed |
| `node --check src/fx/screen-fx.js` / `src/combat/auto-attack.js` / `src/monsters/ai.js` / `src/ui/screens.js` / `src/ui/overlays.js` | 全部 exit 0 |
| `index.html` SHA256 | `a6804b0a59e5b12073a1f9227b8d823547c701f361007399277a9fc6b7c53692`（未变，仍 26 契约脚本 + tests/perf.js） |

## 5. 遗留与风险

1. **真实浏览器目视/帧率未由运营实测**：本环境为 Node 假 DOM，无浏览器；人物/敌人/掉落物/标题/卷轴/结算背景是否在 Edge/Chrome 中实际可见、是否无控制台错误，需质检或客户复验。
2. **正式美术仍为占位**：`tools/art/MANIFEST.json` 14 项均为 failed（缺 torch），当前显示的是自绘 SVG 占位；依赖安装后需 art-generator 重新生成、env-bootstrap 接入，加载链会自动优先 webp。
3. **纯大写资产 id 可加载**（正则带 i 标志）：bridge 未规定大小写；现有 id 全小写，测试已记录该行为，不构成阻断。
4. `sword-qi` 仅运行时使用（无生成资产），已有占位 SVG。
5. 多次 findstr 调用触发 ShellGate 审计警告（`.ans/sessions/...` 会话日志被记为 modified，已记录 `docs/audit/shell-gate.jsonl`），属环境副作用，未回滚。

## 6. 下一步

- 质检独立核对：读本报告与 bridge 文档，复跑测试、抽查加载链/回退与 27 脚本约束；按规则决定是否发起验收卡。
- 客户/质检在桌面浏览器复验：标题页、门派卷轴、对局中人物/三类敌人/三类掉落、攻击拖尾/命中火花/击杀消散、结算页背景、F3 不降级。
- 运营不代客户验收、不提交 acceptance 卡。
