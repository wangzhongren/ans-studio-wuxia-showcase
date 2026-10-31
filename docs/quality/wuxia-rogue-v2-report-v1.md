# wuxia-rogue-v2 最终验收核对报告 v1

- 日期：2026-10-31
- 流程：`wuxia-rogue-v2`｜run：`run-20261031-wuxia-rogue-v2-91a1b83a`（state=pinned，pinnedAt 2026-10-31T09:55:23.148Z）
- 任务：`#t-mvwe3129-4c5adf60`（幕僚派发：终验核对并由质检发起验收卡）
- 角色：质检（verifier）
- 方式：只读核对 + 本地自动化复跑；未修改任何实现文件（仅新增本报告与 `docs/verification/wuxia-rogue-v2-final-check.py` 证据脚本）
- **结论：自动化与静态核对全绿；但发现 1 项口径不一致（`ui-scroll` 生成后运行时零引用，与「17 项素材已全部接入」的表述不符）。按派发要求「若发现任何不一致或未达标项，如实列出并回报，不发起通过卡」，本轮不发起验收卡，交回幕僚澄清/处置后再复核。**
- 视觉验收：AC-9 ~ AC-13 的真实浏览器人工目视**尚未进行**，本报告不代客户判定视觉通过；`tests/bench.js` 仅为 Node 逻辑基线，不代表浏览器帧率。

---

## 1. 核对依据

按派发顺序读完：

1. `docs/contracts/wuxia-rogue-v2-architecture-v1.md`
   - 实测 SHA256：`d4bec46b8d05157563b1da2bc2462c8a3a86d2fe5ebfe9e1519e49656715c152`，与派发哈希一致。
2. `docs/product/wuxia-rogue-v2-intent-v1.md`（AC-1 ~ AC-13）
3. `docs/scheduling/wuxia-rogue-v2-delivery-plan-v1.md`
4. `docs/scheduling/wuxia-rogue-v2-delivery-report-v1.md`（历史态，其中 14/14 failed 的素材状态已被后续文档/产物取代）
5. `docs/scheduling/wuxia-rogue-v2-feedback2-verify-v1.md`（已记录 `ui-scroll` 在 `src/` 命中 0）
6. `docs/scheduling/wuxia-rogue-v2-art-render-bridge-v1.md`（允许 `sword-qi` 缺失并用占位）

契约速查确认：architecture 钉在 `d4bec46b8d05…`；项目角色 8 个；verifier 可写边界为 `docs/quality/`、`docs/verification/`、`docs/governance/verifier/`。

---

## 2. 独立核对结果

### 2.1 入口与脚本顺序

- `index.html` 实测 SHA256：`a6804b0a59e5b12073a1f9227b8d823547c701f361007399277a9fc6b7c53692`。
- 外部脚本 **27** 个，内联脚本 **0** 个，`defer` **27** 个。
- 前 26 个顺序与 architecture §3.2 完全一致；第 27 个为 `tests/perf.js`（计划中已声明的偏差）。
- 未发现远程脚本、CDN、内联初始化代码。

### 2.2 生成素材与 SOURCES 一致性

- `assets/generated/SOURCES.md`：17 条；`tools/art/MANIFEST.json`：17 条且全部 `status: ok`；`generatedAt: 2026-10-31T12:27:10Z`。
- 17 个 WebP 全部存在、可解码；逐项字节数与 SHA256 与 SOURCES 表项**逐一相符**（脚本比对 bad=0）。
- 素材构成：10 个精灵（RGBA 透明）+ 7 个背景（RGB 不透明）。

| id | bytes | 尺寸 | 模式 | sha256（前 16 位） |
| --- | ---: | --- | --- | --- |
| player | 3636 | 96×96 | RGBA | `8784b81f604616d7` |
| weapon-sword | 1146 | 96×96 | RGBA | `2012cd513bc0e898` |
| weapon-blade | 1918 | 96×96 | RGBA | `73eeea9aa13a5390` |
| weapon-needle | 830 | 96×96 | RGBA | `a9a096d0b33d2ce9` |
| monster-wanderer | 4638 | 96×96 | RGBA | `bc9d3d1a1ef66b54` |
| monster-bowman | 5604 | 96×96 | RGBA | `b0d0522d98cdd174` |
| monster-blade | 5802 | 96×96 | RGBA | `6aab746711edb6a3` |
| drop-xp | 1820 | 48×48 | RGBA | `cd938b5ca5691e29` |
| drop-silver | 1794 | 48×48 | RGBA | `e684ea34c698bb9f` |
| drop-potion | 2810 | 48×48 | RGBA | `38c51ae2bcd96e5c` |
| title-bg | 61342 | 1280×720 | RGB | `0b1390c11c4253b6` |
| ui-result | 81372 | 1280×720 | RGB | `79a91d340817fd6c` |
| ui-stele | 116100 | 1024×512 | RGB | `1de7449426588bee` |
| ui-scroll | 30324 | 1024×512 | RGB | `64b011c1d83e79fa` |
| sect-jianzong | 24326 | 256×384 | RGB | `560b6cb0d7193bf2` |
| sect-daomen | 27348 | 256×384 | RGB | `e5dd9779998bf0e4` |
| sect-yigu | 21696 | 256×384 | RGB | `b78d522a9f3d7e3d` |

### 2.3 透明通道

- 10 个精灵全部 RGBA，四角 alpha 均为 0；alpha=0 像素占比 0.39 ~ 0.97，未出现整图透明。
- 7 个背景全部 RGB，四角无 alpha 通道，alpha=0 占比 0（不透明背景，符合用途）。
- 抽查 `player`、`monster-blade`、`drop-potion`、`drop-silver` 等看图：主体完整、背景透明，未见整图抠空或深色方块。

### 2.4 加载链与回退

`src/fx/screen-fx.js` 实测：

- 每个 id 只创建一个 `Image`；
- 先加载 `assets/generated/<id>.webp`；`error` 后切到 `assets/placeholder-<id>.svg`；再失败标记 missing；
- `assetDraw` 在 `ctx.drawImage` 不可用或图片未 ready 时返回 `false`，调用方走几何/CSS 回退；
- 回退静默，不弹错、不阻断启动；
- 固定池：`SPARK_CAP=32`、`DISSOLVE_CAP=16`、`RAIN_CAP=56`，复用槽位；
- `setDegrade(true)` 仅在 `updateDegrade`（FPS 阈值）内调用，F3 不强制降级。

DOM 侧 `screens.js` / `overlays.js` 各自只有 1 个 `error` 监听：generated → placeholder → 移除节点，符合桥接约束。

### 2.5 画布/DOM 接入

- 玩家、武器层、剑气、三段拖尾：`src/combat/auto-attack.js`；
  - `WEAPON_BY_SECT = { jianzong: weapon-sword, daomen: weapon-blade, yigu: weapon-needle }`；
  - `weapon-needle` missing 时依次回退 `weapon-sword`、几何剑。
- 怪物类型映射、受击白闪、弓手箭矢：`src/monsters/ai.js`；
  - `ASSET_BY_TYPE = { youxia: monster-wanderer, archer: monster-bowman, daoke: monster-blade, bloodmaster: monster-blade }`。
- 掉落图：`src/loot/pickup.js`（`drop-xp` / `drop-silver` / `drop-potion`，有几何回退）。
- 标题/结算/门派图：`src/ui/screens.js`、`src/ui/overlays.js`；
  - `title-bg`、`ui-result`、`sect-jianzong/daomen/yigu`（后三者由 `'assets/generated/sect-' + id + '.webp'` 动态拼接）、`ui-stele`（仅门派覆盖层）。
- `src/core/main.js` 状态机：`title → sect → playing ⇄ choice → result`，同 seed 重置 RNG。

### 2.6 升级三选一透明弹层（源码）

- choice 分支使用 `overlay overlay--choice`，**不请求背景图**；
- `.overlay--choice` 与 `.overlay__panel` 背景透明、无边框/阴影/backdrop-filter；
- 只有门派分支调用 `addImage(..., 'assets/generated/ui-stele.webp', 'overlay__bg')`；
- 选项由上游恰好 3 个传入，`activeIndex=0` 仅为高亮，未选择前不自动应用；
- 选择后立即生效并关闭面板；下一次升级重新生成 3 项。

### 2.7 运行时零依赖 / 非卡牌静态扫描

- `src/` 共 27 个 JS 文件；未发现 `http(s)://` 远程资源、`fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource`；
- 未发现 `tools/art`、生成脚本或模型路径被运行时引用；
- 未发现 `card` / `deck` / `hand` 等卡牌命名（`card_hits: []`）；
- 样式仅 `styles/theme.css`，无 `overlay--choice` 背景图或 `ui-scroll` 引用。

### 2.8 回归测试（本轮实测）

| 套件 | 结果 |
| --- | --- |
| `node tests/integration-check.js --failures` | **575 passed, 0 failed** |
| `node tests/smoke-core.js` | **76 passed, 0 failed** |
| `node tests/perf-check.js` | **52 passed, 0 failed** |
| `node tests/background-check.js` | **31 passed, 0 failed** |
| `node tests/loop-check.js` | **15 passed, 0 failed** |
| `node tests/perf-integration-check.js` | **16 passed, 0 failed** |
| `node src/sects/self-check.js` | **137 passed, 0 failed** |
| `node tests/bench.js` | p50 0.072 ms / **p95 0.117 ms** / p99 0.185 ms，PASS（仅 Node 基线） |

均 exit 0。

### 2.9 证据脚本

`docs/verification/wuxia-rogue-v2-final-check.py`（只读）：

- 解析 SOURCES / MANIFEST；对 17 个 WebP 计算 bytes / sha256 / 模式 / 尺寸 / 四角 alpha / alpha=0 占比；
- 解析 `index.html` 脚本顺序与 inline/defer；
- 扫描 27 个 src JS 的远程 URL、网络 API、`tools/art` 引用；
- 检查透明弹层、加载链常量、五处接入标记、卡牌词；
- 实测输出：`"pass": true`、`"failures": []`、exit 0。

复现：`tools/art/venv/Scripts/python.exe docs/verification/wuxia-rogue-v2-final-check.py`（系统 `python` 无 PIL，需用项目 venv）。

---

## 3. 发现的问题 / 不一致（按派发要求，先列清、不发起通过卡）

### F1（阻断发卡口径）`ui-scroll.webp` 已生成但运行时零引用

- 文件存在且与 SOURCES 一致（1024×512、30324 B、sha256 `64b011c1…`）。
- 对 27 个 `src/*.js` + `index.html` + `styles/theme.css` 全量检索 `ui-scroll`：**命中 0**。
- 原因：客户反馈后升级三选一改为**无背景透明弹层**，不再使用卷轴背景；门派覆盖层仍用 `ui-stele`。
- 影响：
  - 不影响当前任何已展示画面（`ui-scroll` 不显示）；
  - 但派发前提「17 项素材已全部生成并接入」不准确：准确口径是 **17/17 生成，16/17 运行时引用，1 项 `ui-scroll` 为孤立产物**；
  - 严格按 AC-13 ②「生成物……被游戏实际引用」逐项核对时，该项不满足。
- 处置建议（需幕僚确认其一）：
  1. 明确 `ui-scroll` 为「保留但不再使用」的素材，并修正 SOURCES/交付表述（需说明该文件不参与验收）；
  2. 或给出一个不违反「透明弹层」客户要求的实际用途，重新接入后复核。
- 在确认前，本报告不把 AC-13 ② 记为全部通过，也不发验收卡。

### F2（非阻断，已如实登记）`sword-qi` 仅有占位

- `assets/generated/sword-qi.webp` 不存在；运行时使用 `assets/placeholder-sword-qi.svg` + 几何回退。
- `assets/README.md` 第 19/69/141 行已如实登记其占位身份；bridge 文档也明确允许缺失。
- 因此 AC-13 ④「哪些生成、哪些保留占位」有记录；但 SOURCES 的 17 条汇总不包含该项，建议在汇总备注中补一句，避免读者误以为全部 18 项均已生成。

### F3（必须由客户在真实浏览器完成）AC-9 ~ AC-13 视觉未验收

- 本轮全部为 Node fake DOM / 静态源码 / 图像文件核对，**没有启动真实浏览器**，没有浏览器 FPS 数据。
- AC-9 ~ AC-13 明确要求真实浏览器人工目视；质检不得代客户判定。此项在发卡后由客户按第 4 节清单核验。

### F4（文档轻微过期）`assets/README.md` 对 `ui-scroll` 的用途描述

- 表中写 `ui-scroll` 用于「门派选择覆盖层」，但当前门派覆盖层用 `ui-stele`，choice 无背景。属文档陈旧，不影响运行；可在 F1 处置时一并同步。

### F5（环境审计说明）ShellGate 报告 `.ans` 会话日志被修改

- 多次 `run_shell` 回执附注 `modified:.ans/sessions/verifier/...jsonl`。质检未主动写该文件，判断为会话日志自身写入；已记录于此，不作为验收证据。

---

## 4. 验收卡前置材料（待 F1 澄清后发出）

若幕僚确认 F1 属「保留但不使用」并修正表述，验收卡应包含以下**客户真实浏览器目视清单**：

1. **开始页**：双击 `index.html` 后先出现独立开始页（非直接战斗）；可见游戏名、可阅读的玩法说明、「开始游戏」入口。
2. **门派选择**：至少剑宗 / 刀门 / 医谷 3 项；各有定位/属性说明；选不同门派进入后初始属性或成长有可观察差异。
3. **升级三选一透明弹层**：升级时恰好 3 个选项；弹层**无背景图**、不遮挡玩法视野；未选择前不自动选择；选择后立即生效，下一次升级再出 3 项；全程无抽牌/手牌/牌组。
4. **战斗画面**：玩家、三种武器、三类怪物、剑气/箭矢、掉落物均为生成美术或透明精灵，不是纯色块；受击有白闪；掉落可拾取。
5. **后期清怪**：推进到后期，同屏怪物明显增多，有范围清怪与成片消失的视觉反馈；帧率可玩、不持续卡死。
6. **结算页**：死亡/通关后自动进入结算页；展示存活时间、等级、击杀数、拾取数、银两、最终攻击力、S/A/B/C 评分；抽查等级/击杀/存活时间与本局一致；「再来一局」可开新局。
7. **断网运行**：断网后重新打开并游玩，功能正常；无模型加载、无网络请求、不依赖 Python。
8. **素材差异**：与程序化占位相比，标题、角色、怪物、UI 有可辨识的美术差异。

---

## 5. 结论

- 代码、脚本顺序、素材文件与 SOURCES 一致性、透明通道、加载回退链、透明弹层源码、运行时零依赖、非卡牌扫描、全量回归：**均通过**。
- 存在 1 项与交付表述不符的事实：`ui-scroll.webp` 生成后运行时零引用（F1），另有 `sword-qi` 占位登记与浏览器视觉未验收两项已知限制（F2/F3）。
- 按派发指令，**本轮不发起 `cardKind=acceptance` 验收卡**；请幕僚对 F1 给出处置口径（保留并修正表述 / 重新接入），并对 F2 的汇总备注做补充。复核通过后再由质检发卡，客户在真实浏览器做最终判定。

---

## 6. 证据路径

- 本报告：`docs/quality/wuxia-rogue-v2-report-v1.md`
- 核对脚本：`docs/verification/wuxia-rogue-v2-final-check.py`
- 素材清单：`assets/generated/SOURCES.md`、`tools/art/MANIFEST.json`
- 契约：`docs/contracts/wuxia-rogue-v2-architecture-v1.md`
- 运行入口：`index.html`
- 加载链：`src/fx/screen-fx.js`
- 接入：`src/combat/auto-attack.js`、`src/monsters/ai.js`、`src/loot/pickup.js`、`src/ui/screens.js`、`src/ui/overlays.js`
- 测试：`tests/integration-check.js`、`tests/smoke-core.js`、`tests/perf-check.js`、`tests/background-check.js`、`tests/loop-check.js`、`tests/perf-integration-check.js`、`src/sects/self-check.js`、`tests/bench.js`
