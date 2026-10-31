import hashlib

src = "docs/proposals/wuxia-rogue-proposal-v1.md"
dst = "docs/proposals/wuxia-rogue-v1.md"
b = open(src, "rb").read()
open(dst, "wb").write(b)
print(len(b), hashlib.sha256(b).hexdigest())
