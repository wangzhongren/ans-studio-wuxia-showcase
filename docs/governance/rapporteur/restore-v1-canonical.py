import hashlib

p = "docs/proposals/wuxia-rogue-proposal-v1.md"
s = open(p, encoding="utf-8", newline="").read()
note = (
    "> **规范路径物证说明**：本文件是 `docs/proposals/wuxia-rogue-proposal-v1.md`"
    "（run pin 钉住的提案，sha256 63dd139f…）的**同一 v1 规范路径物证**——"
    "同一 `flowId=wuxia-rogue`、同一 `version=1`、同一 `intentId=wuxia-rogue-map`，"
    "正文内容一致，未新增版本、未改写任何已冻结文件。按验收链要求的规范命名 "
    "`docs/proposals/<flowId>-v1.md` 提供可读物证；两者内容冲突时以 run pin 的 "
    "`wuxia-rogue-proposal-v1.md` 为准。\n\n"
)
key = "# 江湖夜雨 · 武侠大地图 Roguelike 原型（wuxia-rogue）策划方案 v1\n\n"
assert key in s, "h1 not found"
out = s.replace(key, key + note, 1)
open("docs/proposals/wuxia-rogue-v1.md", "w", encoding="utf-8", newline="").write(out)
b = out.encode()
print(len(b), hashlib.sha256(b).hexdigest())
