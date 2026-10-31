# assets/generated/ · 生成素材接入位与来源清单

> 模块：env-resources（属主 env-bootstrap）
> 契约：`docs/contracts/wuxia-rogue-v2-architecture-v1.md` §3.1 / §6.2 / §6.4
> 当前阶段：**17 项生成 WebP**；其中 **16 项运行时引用**，`ui-scroll` 保留不用（客户要求升级三选一透明、无背景；门派覆盖层使用 `ui-stele`）。

## 1. 接入与转换规则

1. **唯一真源**：离线美术流水线的 `tools/art/MANIFEST.json`（art-generator 维护，17 条）；本文件逐项对应。
2. **精灵透明化**：仅从图像四边种子做 4 邻接泛洪，只清除与边缘连通的背景；默认 `local_tol=10`、`max_dist=80`。`monster-blade` 为暗色人物+暗红背景，使用 `local_tol=2`、`max_dist=40`，并移除小于 8 px 的孤立前景噪点，避免侵蚀人物。`drop-potion` / `drop-silver` 为纯黑背景且主体可能触边，使用边缘连通全局泛洪 `tol=30`（仅以匹配边缘色的边界像素为种子），避免裁掉瓶口/元宝边缘。
3. **编码**：精灵输出 RGBA WebP，`lossless=True`、`method=6`，保留 alpha；背景输出 RGB WebP，`quality=88`、`method=6`，保持不透明。
4. **尺寸**：输出宽高必须与源 PNG 逐项完全一致（PIL 解码核对）。
5. **drop 补转**：`drop-potion` / `drop-silver` 已由 art-generator 重生成（纯黑背景、单只青绿药瓶/银白元宝居中），本轮按边缘连通流程补转透明 WebP；四角 alpha=0，主体保留，旧例外记录作废。
6. **运行时零依赖**：只读本地文件；不联网、不加载模型、不依赖 Python。加载失败由 UI 层 `onerror` 回退占位，不阻塞启动。
7. **版权**：素材为项目自绘或本机离线生成，无第三方版权素材、无远程 URL。
8. **变更同步**：新增或替换资产时同步更新本文件与 `MANIFEST`；验收以两者一致为准。

## 2. 17 项资产清单

| # | 资产 id | 类型 | 运行时路径 | 尺寸 | 处理 | 状态 | 字节 | sha256 | 回退占位 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | player | sprite | `assets/generated/player.webp` | 96×96 | 边缘连通背景抠除 local_tol=10/max_dist=80；透明 alpha；lossless/method=6 | **ok** | 3636 | `8784b81f604616d73461e02fa5652a160cf5c538bf3884e0b544837c8d72fede` | `assets/placeholder-player.svg` |
| 2 | monster-wanderer | sprite | `assets/generated/monster-wanderer.webp` | 96×96 | 边缘连通背景抠除 local_tol=10/max_dist=80；透明 alpha；lossless/method=6 | **ok** | 4638 | `bc9d3d1a1ef66b5443e470eb8fab02c88c9859ae66eede6934d8ae3c3298195a` | `assets/placeholder-monster-wanderer.svg` |
| 3 | monster-bowman | sprite | `assets/generated/monster-bowman.webp` | 96×96 | 边缘连通背景抠除 local_tol=10/max_dist=80；透明 alpha；lossless/method=6 | **ok** | 5604 | `b0d0522d98cdd17455549a136a784901fe45a00b148b5f7f9c27351f205a9c36` | `assets/placeholder-monster-bowman.svg` |
| 4 | monster-blade | sprite | `assets/generated/monster-blade.webp` | 96×96 | 边缘连通背景抠除 local_tol=2/max_dist=40 + 去孤岛<8px；透明 alpha；lossless/method=6 | **ok** | 5802 | `6aab746711edb6a3d2c659f58f7049b51074d3f7747013dad992200dcb7692e4` | `assets/placeholder-monster-blade.svg` |
| 5 | weapon-sword | sprite | `assets/generated/weapon-sword.webp` | 96×96 | 边缘连通背景抠除 local_tol=10/max_dist=80；透明 alpha；lossless/method=6 | **ok** | 1146 | `2012cd513bc0e8983101180f83deaa917849dee4db66176732205a7acd9d9bc1` | `assets/placeholder-weapon-sword.svg` |
| 6 | weapon-blade | sprite | `assets/generated/weapon-blade.webp` | 96×96 | 边缘连通背景抠除 local_tol=10/max_dist=80；透明 alpha；lossless/method=6 | **ok** | 1918 | `73eeea9aa13a53905eaa7df4311ac6a200585741b62d0755355d340b4da46a45` | `assets/placeholder-weapon-blade.svg` |
| 7 | weapon-needle | sprite | `assets/generated/weapon-needle.webp` | 96×96 | 边缘连通背景抠除 local_tol=10/max_dist=80；透明 alpha；lossless/method=6 | **ok** | 830 | `a9a096d0b33d2ce9d4fe9816ecb1b1fdd85ee4b19ce877475829f96a49d5669c` | `assets/placeholder-weapon-needle.svg` |
| 8 | drop-potion | sprite | `assets/generated/drop-potion.webp` | 48×48 | 边缘连通背景抠除 global_tol=30；透明 alpha；lossless/method=6 | **ok** | 2810 | `38c51ae2bcd96e5c76383c0ab17d220c3f07ca195f5114c39518d4c2a50bfb92` | `assets/placeholder-drop-potion.svg` |
| 9 | drop-silver | sprite | `assets/generated/drop-silver.webp` | 48×48 | 边缘连通背景抠除 global_tol=30；透明 alpha；lossless/method=6 | **ok** | 1794 | `e684ea34c698bb9ff33725f84728f680be15b4e44199d6224d970f3ab37ffe7a` | `assets/placeholder-drop-silver.svg` |
| 10 | drop-xp | sprite | `assets/generated/drop-xp.webp` | 48×48 | 边缘连通背景抠除 local_tol=10/max_dist=80；透明 alpha；lossless/method=6 | **ok** | 1820 | `cd938b5ca5691e29cc14b7f31f8f5add9df42113ee954d73f4cd0762aba1b16f` | `assets/placeholder-drop-xp.svg` |
| 11 | title-bg | background | `assets/generated/title-bg.webp` | 1280×720 | 不透明 RGB；quality=88/method=6 | **ok** | 61342 | `0b1390c11c4253b620f9525ea6615917304478223de5949ed3fb9bc62aeb9858` | `assets/placeholder-title-bg.svg` |
| 12 | ui-result | background | `assets/generated/ui-result.webp` | 1280×720 | 不透明 RGB；quality=88/method=6 | **ok** | 81372 | `79a91d340817fd6cb090f3d82d8d3e091564ffa0290941f445a5cd3ede3db6ec` | `assets/placeholder-ui-result.svg` |
| 13 | ui-scroll | background | `assets/generated/ui-scroll.webp` | 1024×512 | 不透明 RGB；quality=88/method=6；已生成、保留不用（运行时零引用） | **ok** | 30324 | `64b011c1d83e79faf01996ab0d025a65ed8ccd1f502eb178d25a9e20cd257938` | `assets/placeholder-ui-scroll.svg` |
| 14 | ui-stele | background | `assets/generated/ui-stele.webp` | 1024×512 | 不透明 RGB；quality=88/method=6 | **ok** | 116100 | `1de7449426588beef0bff3d37ee6ea93a10f9d9b49586b10c1b07148c0b894fb` | `assets/placeholder-ui-stele.svg` |
| 15 | sect-jianzong | background | `assets/generated/sect-jianzong.webp` | 256×384 | 不透明 RGB；quality=88/method=6 | **ok** | 24326 | `560b6cb0d7193bf2e334dd80549c13b34e02a750c2e6570a48c1373c879367c9` | `assets/placeholder-sect-jianzong.svg` |
| 16 | sect-daomen | background | `assets/generated/sect-daomen.webp` | 256×384 | 不透明 RGB；quality=88/method=6 | **ok** | 27348 | `e5dd9779998bf0e4be3ad69575a57ed711ea08abfdd5a2a318bf93885cf06171` | `assets/placeholder-sect-daomen.svg` |
| 17 | sect-yigu | background | `assets/generated/sect-yigu.webp` | 256×384 | 不透明 RGB；quality=88/method=6 | **ok** | 21696 | `b78d522a9f3d7e3dda630f2bd0936db5f6633089ed963cfdbf89e4f193d4ce13` | `assets/placeholder-sect-yigu.svg` |

## 3. 逐项校验数据（PIL 解码）

| 资产 id | 格式/模式 | 四角 alpha | alpha=0 占比 | 非透明占比 | 中心非透明占比 |
| --- | --- | --- | --- | --- | --- |
| player | WEBP/RGBA | 0/0/0/0 | 0.8061 | 0.1939 | 0.6441 |
| monster-wanderer | WEBP/RGBA | 0/0/0/0 | 0.7887 | 0.2113 | 0.6289 |
| monster-bowman | WEBP/RGBA | 0/0/0/0 | 0.7221 | 0.2779 | 0.7357 |
| monster-blade | WEBP/RGBA | 0/0/0/0 | 0.6687 | 0.3313 | 0.8815 |
| weapon-sword | WEBP/RGBA | 0/0/0/0 | 0.9544 | 0.0456 | 0.1350 |
| weapon-blade | WEBP/RGBA | 0/0/0/0 | 0.9183 | 0.0817 | 0.1793 |
| weapon-needle | WEBP/RGBA | 0/0/0/0 | 0.9671 | 0.0329 | 0.0490 |
| drop-potion | WEBP/RGBA | 0/0/0/0 | 0.3915 | 0.6085 | 0.9358 |
| drop-silver | WEBP/RGBA | 0/0/0/0 | 0.4757 | 0.5243 | 0.9965 |
| drop-xp | WEBP/RGBA | 0/0/0/0 | 0.5703 | 0.4297 | 0.9792 |
| title-bg | WEBP/RGB | 255/255/255/255 | 0.0000 | 1.0000 | — |
| ui-result | WEBP/RGB | 255/255/255/255 | 0.0000 | 1.0000 | — |
| ui-scroll | WEBP/RGB | 255/255/255/255 | 0.0000 | 1.0000 | — |
| ui-stele | WEBP/RGB | 255/255/255/255 | 0.0000 | 1.0000 | — |
| sect-jianzong | WEBP/RGB | 255/255/255/255 | 0.0000 | 1.0000 | — |
| sect-daomen | WEBP/RGB | 255/255/255/255 | 0.0000 | 1.0000 | — |
| sect-yigu | WEBP/RGB | 255/255/255/255 | 0.0000 | 1.0000 | — |

## 4. 汇总

| 指标 | 数量 |
| --- | --- |
| 总条目（与 MANIFEST 一致） | 17 / 17 |
| MANIFEST `ok`（源图生成） | 17 / 17 |
| 已生成 WebP（generated；≠ 运行时引用） | 17 / 17 |
| 运行时引用（src/index/styles 实际引用） | 16 / 17 |
| 保留不用（ui-scroll，运行时零引用） | 1 / 17 |
| 精灵透明 WebP | 10 / 10 |
| 背景不透明 WebP | 7 / 7 |
| 失败例外（回退占位，未写 WebP） | 0 / 17 |
| 校验失败 | 0 / 17 |

> 说明：MANIFEST 的 `ok` 表示源 PNG 生成成功；`generated` 表示本目录真实存在且通过 PIL 校验的 WebP，**不等于运行时引用**。`drop-potion` / `drop-silver` 重生成后已补转透明 WebP。`ui-scroll` 已生成且文件完整，但客户要求升级三选一为透明弹层、无背景，当前 `src/`、`index.html`、`styles/theme.css` 均未引用它；门派覆盖层使用 `ui-stele`。因此运行时引用为 16/17，`ui-scroll` 保留不用。

## 5. 回退链

`assets/generated/<id>.webp` → `assets/placeholder-<id>.svg` → 代码内几何绘制 / CSS 样式。

- 17 项生成 WebP 存在且通过校验；其中 **16 项运行时引用**，`ui-scroll` 保留不用（不接入、不删除）。
- `drop-potion` / `drop-silver` 已补转透明 WebP；占位 SVG 仅作加载失败时的兜底。
- `sword-qi` 仅占位 `assets/placeholder-sword-qi.svg` + 代码几何回退；**不在 17 项生成清单，非生成资产**。
- 任何素材缺失时游戏仍可启动，回退不阻塞。

## 6. 更新记录

| 日期 | 变更 | 操作者 |
| --- | --- | --- |
| 2026-10-31 | 初始化接入位与 14 项清单（均未接入） | env-bootstrap |
| 2026-10-31 | 新增 3 个武器占位，按 MANIFEST 17 条复核（全部 failed，未接入） | env-bootstrap |
| 2026-10-31 | 17 张源 PNG 转 WebP：15 项接入（8 精灵透明 + 7 背景不透明），2 项 drop 源图无主体回退占位；逐项 PIL 校验 | env-bootstrap |
| 2026-10-31 | drop-potion/drop-silver 重生成后补转透明 WebP，generated 17/17、透明精灵 10/10 | env-bootstrap |
| 2026-10-31 | 质检终验后按幕僚口径修正：17 生成 / 16 运行时引用 / 1 保留不用（ui-scroll）；补充 sword-qi 仅占位说明 | env-bootstrap |

## 7. 核对口径

- 本文件 17 条与 `tools/art/MANIFEST.json` 的 `assets` 一一对应。
- 本文件不参与运行时加载，仅作来源、处理参数与校验记录。
- 运行时引用只允许 `assets/generated/*` 与 `assets/placeholder-*.svg`，不得出现远程地址。
- 武器/怪物/玩家精灵必须带 alpha 且四角 alpha=0；背景必须不透明。
