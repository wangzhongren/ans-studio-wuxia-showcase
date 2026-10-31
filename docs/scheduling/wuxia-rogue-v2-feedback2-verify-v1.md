# 第二轮反馈（素材/透明弹层）核对记录 v1

- 日期：2026-10-31
- 角色：运营（convener）
- 对应幕僚任务：`#t-mvwb1vgl-e42c5c55`
- 结论：**自动化测试全绿；正式生成素材仍被依赖阻塞；透明弹层已落地但待 presentation-fx 报告与浏览器目视确认；未作任何验收判定。**

## 1. 测试套件（本轮实测）

| 套件 | 结果 |
| --- | --- |
| `node tests/integration-check.js --failures` | **575 passed, 0 failed** |
| `node tests/smoke-core.js` | 76 passed, 0 failed |
| `node tests/perf-check.js` | 52 passed, 0 failed |
| `node tests/background-check.js` | 31 passed, 0 failed |
| `node tests/loop-check.js` | 15 passed, 0 failed |
| `node tests/perf-integration-check.js` | 16 passed, 0 failed |

`tests/art-render-check.js` 已由 core-engine 扩展武器断言（266 行起）：
- `weapon-sword / weapon-blade / weapon-needle` 的 ready 断言；
- 剑宗→weapon-sword、道门→weapon-blade、医谷→weapon-needle 的绘制计数与互斥断言；
- 医谷针 missing → 回退 weapon-sword；两者皆 missing → 不绘制且走几何回退；
- missing 场景（396、433 行）已含三个 weapon id。
此前 `素材 missing：不再调用 ctx.drawImage got N, want N-1` 的失败已消除；此前 combat-player / monsters-director 的 blocked 归因（测试期望缺口，非渲染缺陷）得到证实。

## 2. 武器占位（env-bootstrap 返工）

`assets/placeholder-weapon-{sword,blade,needle}.svg` 已改为 **96×96 方形透明背景**（与 combat 方形绘制框、prompt 96×96 一致），无 `<text>`、无外部引用：

| 文件 | bytes | sha256 |
| --- | --- | --- |
| `assets/placeholder-weapon-sword.svg` | 2262 | `9fc39d58d41ce2bce2054849609d3cdae789028785c9ccbc755752f8cb473501` |
| `assets/placeholder-weapon-blade.svg` | 2508 | `2da366093c4c45a7c9ca05f9bf9bc264cdc6ee3f2e6bb77ed04c8625c488dd4e` |
| `assets/placeholder-weapon-needle.svg` | 2447 | `4105065efd60574c0d2baad00eb77cf516d674217e5d36431c5772907e08908e` |

`assets/generated/SOURCES.md` 已同步 17 条，武器三条尺寸列 96×96；汇总仍为 ok 0/17、failed 17/17、generated WebP 0/17、placeholder 17/17。

## 3. 升级三选一弹层（源码观察，尚未收到执行报告）

`src/ui/overlays.js`（23951 bytes，mtime 2026-10-31T11:19:30Z）当前实现：
- choice 使用 `overlay overlay--choice`，**不请求任何背景图**；门派仍使用 `ui-stele` 背景（第 379–382 行）；
- `overlay--choice` 与 `.overlay__panel` 背景透明、无边框/阴影（第 163–164 行），标题/副标题/提示加文字阴影保证可读（第 165 行）；
- 选项仍保留 `stele-option` 的深色渐变卡片样式（第 170 行）——是否满足客户「不要有背景」的目视预期，需浏览器目视与客户/质检判断，不能由本记录代为认定；
- 选项数由上游三选一传入，无自动选中写入；`activeIndex` 默认 0 仅为高亮。

未收到 presentation-fx 本轮执行报告前，不判定该项完成。

## 4. 三份报告的独立核对（2026-10-31 收报后）

### 4.1 env-bootstrap（`#t-mvwbe89k-c6e38c4f`）——核对通过

- 三个武器 SVG 实测尺寸/字节/sha256 与其报告完全一致（见 §2）。
- `assets/generated/SOURCES.md` 实测 6570 B、sha256 `614adaa54f6c7bf8d87cf2e68ed5365ed68145b928409dfafa463c573a7cd9c6`，与其报告一致；17 条 id 与 MANIFEST 对应，武器三条 96×96。
- 除三个武器外，其余 17 个 `placeholder-*.svg` mtime 均早于 11:00Z（实测仅 weapon-* 在 11:25–11:27Z 被改写）。
- 其报告指出的 `assets/README.md` 旧尺寸属实（第 31–33 行曾为 128×32）；已派 env-bootstrap 文档同步任务 `#t-mvwbm5zr-ab1da34d`，并复核通过：README 现 8873 B、sha256 `c334df56e9e2d89c1c9c23025a1358bc615f3895eb4cdbb971be565a1232461d`，三行武器尺寸均为 96×96 且无 128×32；20 个 placeholder 行尺寸与对应 SVG 的 width/height 逐一比对 bad=0；其余文件（三份 SVG、SOURCES.md）哈希未变；集成复跑 575/0。

### 4.2 presentation-fx（`#t-mvwb3j7g-0b0750a4`）——源码核对通过

- `src/ui/overlays.js`（23951 B，mtime 11:19:30Z）choice 分支：`overlay overlay--choice`、`data-overlay-kind=choice`，仅 sect 调用 `addImage(...,'assets/generated/ui-stele.webp')`（379–382 行）。
- 全 `src/` 27 个 js 文件扫描 `ui-scroll` 命中 0。
- 样式（163–165 行）：choice 外层/面板透明、无背景图、无 backdrop-filter，标题/说明/提示加文字阴影；`.stele-option` 保留半透明深色卡片（170 行）。
- 行为：`showChoice` 仅渲染传入选项；`confirmCurrent` 仅在 Enter/Space/点击时触发并立即 `hide()`（496–510 行）；无自动回调；`choice:offer`/`choice:pick` 链路未改。
- 集成测试 [升级三选一] 仍断言 `options.length===3`、`Loop.paused` 切换、选择后 `Overlays.isOpen()===false`（tests/integration-check.js 994/1035/1050–1057 行），全部通过。

### 4.3 core-engine（`#t-mvwbcu9l-be7b7c09`）——核对通过

- integration 575/0、其它五个套件全绿（见 §1）。
- 修改仅 `tests/art-render-check.js`（21544 B，mtime 11:26:56Z）与 `tests/integration-check.js`（55223 B，mtime 11:26:35Z）；`src/`、`index.html`、`assets/` 无该任务时间窗后的改动（源码最新为 combat 11:20:14Z）。
- 其报告中"审计记录到 placeholder-weapon-needle.svg modified"系 env-bootstrap 并发改写（11:27:10Z），当前文件与 env-bootstrap 报告哈希一致，非测试代码写盘。

## 5. 正式生成素材（依赖已就绪，生成进行中）

- 2026-10-31 幕僚确认依赖装好；运营独立实测 `tools/art/venv/Scripts/python.exe -c "import torch, torchvision, diffusers, transformers"` → torch 2.6.0+cu124 / torchvision 0.21.0+cu124 / diffusers 0.42.1 / transformers 5.22.1，`torch.cuda.is_available()=True`（RTX 4090）。
- 运营实测起点：`tools/art/out/` 仅 README.txt；MANIFEST 17 条 ok=0 / failed=17；未伪造产物。批量任务进行中已见 out/ 多张 PNG 与 MANIFEST 刷新（例如 10 ok / 7 failed 的中间态，仅作进度参考，不作为完成依据）。
- 已按"先单项后批量"派 art-generator 第一阶段：`#t-mvwc7m94-00df1887`，命令 `--only player`。**结果已独立核对通过**：`tools/art/out/player.png` 为 96×96 PNG、10417 B、sha256 `bdd9d51ce330a996d2e7628f0f364ced6a7a23c6722233289a58f0c3bd74cedf`，目视为深色背景白衣持剑角色；MANIFEST player 为 status=ok、seed=2026103102、ms=14015；`verify.py`（无 --strict）ok=1/failed=16。
- 说明（如实）：运营核对时运行 `verify.py`，该脚本按设计回填了 `tools/art/MANIFEST.json`（现 11036 B、sha256 `b8727d160a8e20862b35086fea6258eceb780fb6d6d232a09526af72da7df3e5`）；player 条目与 ok/failed 计数未变，审计已记录该写入。
- 已派第二阶段批量生成其余 16 项：`#t-mvwccaa5-84a21f9d`（单进程 `--only` 16 个 id，随后 `verify.py --strict`）。**回交后独立复核通过**：17 张 PNG 全部存在且像素尺寸与各自提示词完全一致（bad=0），MANIFEST 17/17 ok、generatedAt 2026-10-31T11:57:00Z；抽样哈希与报告一致（player bdd9d51c…、weapon-sword 0497e99f…、monster-wanderer 4b779f79… 等）；view_image 抽查 weapon-sword / monster-wanderer 为深色背景上的真实主体，符合预期（背景待转换抠除）。
- 已派转换阶段任务给 env-bootstrap：`#t-mvwcor28-1945faa6`（`assets/generated/*.webp` 落位 + 按 §7 抠除 + SOURCES 回填 + 集成复跑）。**回交后独立复核通过（15/17，2 项如实例外）**：
  - 15 个 WebP 实测均存在且可解码：8 个精灵为 RGBA、四角 alpha=0、尺寸与源 PNG 一致（alpha=0 占比与报告一致，如 player 7429/9216、monster-wanderer 7269/9216、weapon-sword 8796/9216）；7 个背景为 RGB、四角 alpha=255、alpha=0 占比 0，尺寸 1280×720 / 1024×512 / 256×384 与源一致。`view_image` 抽查 player.webp（透明背景、白衣持剑完整）与 monster-blade.webp（暗红人物主体保留，无整图透明）。
  - `assets/generated/SOURCES.md` 9888 B、sha256 `9626ca0c5460d847bf88976f9e29a234cd594183c47fc6aca549f7bc658dc0dd`；15 条已生成行的字节/sha256 与真实文件逐一相符（独立比对 bad=0）；汇总 generated 15/17、透明精灵 8/10、背景 7/7、例外 2/17、failed 0/17。
  - 转换器 `assets/tools/convert_webp.py` 22224 B、sha256 `808a6e6d…b27524`；未发现 tools/art、MANIFEST、src、tests 被改动。
  - 例外独立复核：drop-potion.png / drop-silver.png 目视几乎为纯噪声（RGB 范围分别 2–17、0–39，std 2.06 / 13.14），确无清晰瓶身/银两主体；未写不可用 WebP、回退既有透明占位 SVG，符合任务例外条款。
  - 复跑：integration-check 575/0；smoke-core 76/0、perf-check 52/0、background-check 31/0、loop-check 15/0、perf-integration-check 16/0。
- 客户要求掉落也需正式素材（幕僚任务 `#t-mvwdhsb9-c7458146`）：已派 art-generator 重生成两项 `#t-mvwdi622-96c5aceb`。**回交后独立复核通过**：drop-potion.png 48×48、3332 B、sha256 `ae4f8601…43aae0`，纯黑背景单只青绿药瓶，RGB std 61/119/70、非背景占比 0.600；drop-silver.png 48×48、3320 B、sha256 `0af40252…`，单枚银白元宝，std 104/104/105、非背景占比 0.497；view_image 两项均轮廓清晰可辨；MANIFEST 两项 seed 2026103201/2026103202、ms 13251/13329、17/17 ok；其余 15 张 PNG mtime 未变。已派 env-bootstrap 补转两项为透明 WebP 并回填 SOURCES：`#t-mvwdo3p6-93ca02bd`。**回交后独立复核通过**：drop-potion.webp 48×48 RGBA、2810 B、sha256 `38c51ae2…0bfb92`、四角 alpha=0、alpha=0 占比 902/2304≈0.3915；drop-silver.webp 48×48 RGBA、1794 B、sha256 `e684ea34…ffe7a`、四角 alpha=0、alpha=0 占比 1096/2304≈0.4757；view_image 两项主体清晰、背景透明。SOURCES.md 9934 B、sha256 `5ceafb3d62dd6764d946a6b0d6a160a883886e79be3fe53e3192edaf490b37e6`，17 条表项的字节/sha256 与真实文件逐一比对 bad=0，汇总 generated 17/17、精灵 10/10、背景 7/7、例外 0/17；转换器 `assets/tools/convert_webp.py` 21339 B、sha256 `29add03b…ad5969`（仅 stdlib+PIL，无网络/子进程/删除调用）；17 个 WebP 中仅两个 drop 的 mtime 为 12:32，其余未被重写。集成 575/0、smoke 76/0。
- 后续阶段（待批量成功）：env-bootstrap 转 WebP（武器 alpha 抠底）并回填 SOURCES/MANIFEST 计数 → core-engine 按需更新静态断言 → 复跑集成（575/0 基线）。

## 6. 未完成 / 下一步

1. `assets/README.md` 武器尺寸同步已完成并复核（8873 B / c334df56…；20 行尺寸匹配、无 128×32；集成 575/0），无遗留文档项。
2. 生成+转换全部完成并复核：17/17 PNG ok；17/17 WebP 落位（10 精灵透明 + 7 背景不透明），生成无例外；SOURCES 与真实文件一致；六套测试全绿（integration 575/0）。**引用口径（质检终验 F1/F2 校正）**：17 项生成 / **16 项运行时引用** / 1 项保留（ui-scroll，已生成但零引用）；sword-qi 仅为占位、不在 17 项生成清单内。剩余仅：真实浏览器目视（场景可见、弹层无背景图、人物/敌人/武器/掉落渲染）与质检/客户最终验收；运营不代判。
3. 真实浏览器目视（场景可见、弹层无背景图、人物/敌人/武器素材渲染）与最终验收由质检/客户完成；本轮不做验收结论。

## 7. 转换阶段背景抠除要求（2026-10-31 幕僚任务，待批量完成后执行）

- 独立复核 player.png 确为不透明：RGBA 96×96，alpha 极值 (252,255)，alpha=0 像素 0/9216；四角约 (36,39,51)、(33,37,51)、(31,36,49)、(34,36,50)。若原样转 WebP 会形成深色方块，必须抠除。
- 精灵类（10 项，输出带 alpha）：player、monster-wanderer/bowman/blade、weapon-sword/blade/needle、drop-xp/silver/potion。
- 背景类（7 项，保持不透明）：title-bg、ui-result、ui-scroll、ui-stele、sect-jianzong/daomen/yigu。
- 方法：从图像边缘出发的连通区域背景填充（颜色容差 + 仅清除与边缘连通像素），保留角色内部深色细节；禁止简单全图阈值。
- 验证：逐项四角 alpha=0、主体非透明像素占比合理（不整图透明）、WebP 可解码；SOURCES 对应条目写入透明处理说明；MANIFEST 状态仍按真实文件回填。
- 顺序：等批量生成（含 verify --strict）结束、确认无进程写 out/ 后，由 env-bootstrap（assets/ 属主）单阶段执行转换，不与生成并行写同一文件。
- **范围确认（质检 F2，幕僚 2026-10-31 决策）**：幕僚清单提到 `sword-qi`，但 17 条 MANIFEST / prompts 中没有该资产（无提示词、无 PNG）；其运行时使用 `assets/placeholder-sword-qi.svg`（本身透明）+ 几何回退。**决定不扩项**：sword-qi 仅按占位资产登记，不得表述为「已生成资产」。

## 8. 质检终验 F1/F2/F4 口径校正（2026-10-31 幕僚任务 `#t-mvwehvbg-f60042de`）

- 依据质检报告 `docs/quality/wuxia-rogue-v2-report-v1.md`：F1 指出「17 项素材已全部接入」与实际不符——`ui-scroll.webp` 已生成但运行时零引用；F2 指出 sword-qi 仅为占位却未注明。
- 运营独立复核（本轮）：`index.html`、`styles/theme.css`、`src/` 27 个 js 全文检索 `ui-scroll` 命中 **0**；`src/ui/overlays.js` choice 分支不挂背景图，门派覆盖层用 `ui-stele.webp`；`tests/` 亦无 ui-scroll 断言。
- 统一口径：**17 项生成 / 16 项运行时引用 / 1 项保留（ui-scroll）**；ui-scroll 保留在 `assets/generated/`（与 SOURCES 一致），因客户要求升级三选一透明弹层而不参与运行时；不得再写「17 项全部运行时引用/全部接入」。
- 已派 env-bootstrap `#t-mvwekfce-3c54181d` 同步 `assets/generated/SOURCES.md` 与 `assets/README.md`（不改 WebP/代码/测试/索引）；运营侧本记录与 `wuxia-rogue-v2-art-render-bridge-v1.md` 同步该口径。
- 真实验收边界不变：真实浏览器目视与最终验收由质检/客户完成，运营不代判、不发验收卡。

