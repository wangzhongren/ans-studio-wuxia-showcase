import hashlib
import re

src = "docs/proposals/wuxia-rogue-proposal-v2.md"
dst = "docs/proposals/wuxia-rogue-proposal-v3.md"

t = open(src, encoding="utf-8", newline="").read()
m = re.match(r"^(---\r?\n)(.*?)(\r?\n---\r?\n)", t, re.S)
fm, body = m.group(2), t[m.end():]

fm = fm.replace("version: 2", "version: 3", 1)
fm = fm.replace(
    "supersedes: docs/proposals/wuxia-rogue-proposal-v1.md",
    "supersedes: docs/proposals/wuxia-rogue-proposal-v2.md",
    1,
)
fm = fm.replace(
    "title: 江湖夜雨 · 武侠大地图 Roguelike 原型策划方案 v2（体验闭环与 AI 美术）",
    "title: 江湖夜雨 · 武侠大地图 Roguelike 原型策划方案 v3（按已批准意图 S9~S13 定稿）",
    1,
)
fm = fm.replace(
    "modules: docs/proposals/wuxia-rogue-modules-v2.md",
    "modules: docs/proposals/wuxia-rogue-modules-v2.md\n"
    "roster: docs/proposals/wuxia-rogue-roster-v6.md\n"
    "architecture: docs/contracts/wuxia-rogue-architecture-v2.md",
    1,
)

h2 = "# 江湖夜雨 · 武侠大地图 Roguelike 原型（wuxia-rogue）策划方案 v2\n\n"
h3 = "# 江湖夜雨 · 武侠大地图 Roguelike 原型（wuxia-rogue）策划方案 v3\n\n"
assert h2 in body
body = body.replace(h2, h3, 1)

note = (
    "> **v3 修订说明**：本版依据已批准的需求变更 `req-36c38669f1d06b83`"
    "（status=approved，changeKind=scope，批准来源=判断 agent「替我决策」代批，"
    "decision=approve 默认推荐项，批准时间 2026-10-31T09:29:57.285Z）"
    "与意图入口 `docs/intents/wuxia-rogue-map.md`（v2）产出。设计内容继承 v2，"
    "未新增范围、授权或成本；单据对齐 `wuxia-rogue-modules-v2.md`（11 模块）、"
    "`wuxia-rogue-roster-v6.md`（8 角色）、`wuxia-rogue-architecture-v2.md`。\n\n"
)
body = body.replace(h3, h3 + note, 1)
body = body.replace("本文件 v2 只读；后续变更出 v3", "本文件 v3 只读；后续变更出 v4", 1)

out = m.group(1) + fm + m.group(3) + body
open(dst, "w", encoding="utf-8", newline="").write(out)
b = out.encode()
print(len(b), hashlib.sha256(b).hexdigest())
