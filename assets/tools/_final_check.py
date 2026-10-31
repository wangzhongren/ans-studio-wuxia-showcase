import hashlib
import re
from pathlib import Path

root = Path(".")
gen = root / "assets" / "generated"
files = sorted(gen.glob("*.webp"))
print("webp_count", len(files))
for p in files:
    b = p.read_bytes()
    print(p.name, len(b), hashlib.sha256(b).hexdigest())

src = (gen / "SOURCES.md").read_text(encoding="utf-8")
rows = {}
for line in src.splitlines():
    m = re.match(r"\| \d+ \| ([a-z-]+) \| (sprite|background) \| `assets/generated/([a-z-]+)\.webp` \|", line)
    if m:
        cols = [c.strip() for c in line.strip().strip("|").split("|")]
        rows[m.group(1)] = cols
print("source_rows", len(rows))
bad = []
for asset_id, cols in rows.items():
    if cols[6] == "**ok**":
        b = (gen / f"{asset_id}.webp").read_bytes()
        if str(len(b)) != cols[7].strip("`"):
            bad.append((asset_id, "bytes", len(b), cols[7]))
        if hashlib.sha256(b).hexdigest() != cols[8].strip("`"):
            bad.append((asset_id, "sha256"))
    elif cols[6] == "**exception**":
        if (gen / f"{asset_id}.webp").exists():
            bad.append((asset_id, "exception-webp-exists"))
print("source_mismatches", bad)
for asset_id in ("drop-potion", "drop-silver"):
    p = root / "assets" / f"placeholder-{asset_id}.svg"
    b = p.read_bytes()
    print("fallback", p.name, p.exists(), len(b), hashlib.sha256(b).hexdigest(),
          "viewBox" in b.decode("utf-8"))
for name in ("assets/generated/SOURCES.md", "assets/tools/convert_webp.py"):
    p = root / name
    b = p.read_bytes()
    print(name, len(b), hashlib.sha256(b).hexdigest())
