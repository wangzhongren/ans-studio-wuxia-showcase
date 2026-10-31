#!/usr/bin/env python3
"""v2 名单/模块/拓扑结构自检（纯 stdlib，只读）。"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MODULES = ROOT / "docs/proposals/wuxia-rogue-modules-v2.md"
ROSTER = ROOT / "docs/proposals/wuxia-rogue-roster-v6.md"


def split_frontmatter(text):
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, re.S)
    if not m:
        raise SystemExit("frontmatter missing")
    return m.group(1)


def section(fm, key):
    """取顶层 key 起始到下一个顶层 key 之前的内容（含缩进）。"""
    lines = fm.splitlines()
    out, inside = [], False
    for ln in lines:
        if re.match(r"^%s:" % re.escape(key), ln):
            inside = True
            out.append(ln)
            continue
        if inside:
            if ln and not ln[0].isspace():
                break
            out.append(ln)
    return "\n".join(out)


def block_after(text, fence):
    m = re.search(r"```%s\r?\n(.*?)\r?\n```" % fence, text, re.S)
    return m.group(1) if m else None


def parse_modules(sec):
    """返回 id -> dict(fields)（仅顶层 - id: 开始的分块）。"""
    mods, cur = {}, None
    for ln in sec.splitlines()[1:]:
        m = re.match(r"^\s{2}- id:\s*(\S+)", ln)
        if m:
            cur = m.group(1)
            mods[cur] = {}
            continue
        if cur is None:
            continue
        m = re.match(r"^\s{4}([A-Za-z]+):\s*(.*)$", ln)
        if m:
            mods[cur][m.group(1)] = m.group(2).strip()
        m2 = re.match(r"^\s{6}- (.*)$", ln)
        if m2:
            mods[cur].setdefault("_list", []).append(m2.group(1).strip())
    return mods


def parse_roles(sec):
    """返回 role_id -> (modules list, displayName)。"""
    roles, cur = {}, None
    for ln in sec.splitlines()[1:]:
        m = re.match(r"^\s{2}- id:\s*(\S+)", ln)
        if m:
            cur = m.group(1)
            roles[cur] = {"modules": []}
            continue
        if cur is None:
            continue
        m = re.match(r"^\s{4}([A-Za-z]+):\s*(.*)$", ln)
        if m:
            k, v = m.group(1), m.group(2).strip()
            if k != "modules":
                roles[cur][k] = v
        m2 = re.match(r"^\s{6}- (\S+)$", ln)
        if m2:
            roles[cur]["modules"].append(m2.group(1))
    return roles


def norm(sec):
    return "\n".join(l.rstrip() for l in sec.strip().splitlines())


def main():
    mtext = MODULES.read_text(encoding="utf-8")
    rtext = ROSTER.read_text(encoding="utf-8")
    mfm, rfm = split_frontmatter(mtext), split_frontmatter(rtext)
    auth = parse_modules(section(mfm, "modules"))
    snap = parse_modules(section(rfm, "modules"))

    errors = []
    if set(auth) != set(snap):
        errors.append("模块 id 集不一致: auth=%s snap=%s" % (sorted(auth), sorted(snap)))
    for mid in sorted(set(auth) & set(snap)):
        a, s = dict(auth[mid]), dict(snap[mid])
        a.pop("_list", None), s.pop("_list", None)
        if a != s:
            errors.append("模块字段漂移 %s: diff=%s" % (
                mid, {k: (a.get(k), s.get(k)) for k in set(a) | set(s) if a.get(k) != s.get(k)}))
    if len(auth) != 11 or len(snap) != 11:
        errors.append("模块数应为 11: auth=%d snap=%d" % (len(auth), len(snap)))
    roles = parse_roles(section(rfm, "roles"))
    owners = {}
    for rid, r in roles.items():
        if not r["modules"]:
            errors.append("角色无模块: %s" % rid)
        for mid in r["modules"]:
            if mid not in snap:
                errors.append("角色 %s 引用未知模块 %s" % (rid, mid))
            owners.setdefault(mid, []).append(rid)
    for mid in snap:
        if len(owners.get(mid, [])) != 1:
            errors.append("模块 %s 属主数=%d (%s)" % (mid, len(owners.get(mid, [])), owners.get(mid)))

    topo = block_after(rtext, "topology")
    if topo is None:
        errors.append("缺 topology 代码块")
    else:
        # 按顶层段切分（modules / roles / management）
        segs, cur_seg = {}, None
        for ln in topo.splitlines():
            if ln and not ln[0].isspace() and ln.rstrip().endswith(":"):
                cur_seg = ln.strip()[:-1]
                segs[cur_seg] = []
                continue
            if cur_seg:
                segs[cur_seg].append(ln)

        tmod_owner, tmod_paths, cur = {}, {}, None
        for ln in segs.get("modules", []):
            m = re.match(r"^\s{2}- id:\s*(\S+)", ln)
            if m:
                cur = m.group(1)
                tmod_paths[cur] = []
                continue
            m = re.match(r"^\s{4}roleId:\s*(\S+)", ln)
            if m and cur:
                tmod_owner[cur] = m.group(1)
            m = re.match(r"^\s{4}paths?:\s*(\S*)$", ln)
            if m and cur and m.group(1):
                tmod_paths[cur].append(m.group(1))
            m = re.match(r"^\s{6}- (\S+)$", ln)
            if m and cur:
                tmod_paths[cur].append(m.group(1))
        if set(tmod_owner) != set(snap):
            errors.append("拓扑 modules id 与 frontmatter 不一致: %s vs %s" % (sorted(tmod_owner), sorted(snap)))
        for mid in sorted(set(tmod_owner) & set(snap)):
            fm_paths = [snap[mid]["path"]] if "path" in snap[mid] else list(snap[mid].get("_list", []))
            if [p.rstrip("/") for p in tmod_paths.get(mid, [])] != [p.rstrip("/") for p in fm_paths]:
                errors.append("拓扑 %s 路径与 frontmatter 不一致: %s vs %s" % (mid, tmod_paths.get(mid), fm_paths))
            if mid in owners and tmod_owner[mid] != owners[mid][0]:
                errors.append("拓扑 %s 属主与 roles 不一致" % mid)

        troles, cur = {}, None
        for ln in segs.get("roles", []):
            m = re.match(r"^\s{2}- id:\s*(\S+)", ln)
            if m:
                cur = m.group(1)
                troles[cur] = []
                continue
            m = re.match(r"^\s{6}- (\S+)$", ln)
            if m and cur:
                troles[cur].append(m.group(1))
        if troles != {rid: r["modules"] for rid, r in roles.items()}:
            errors.append("拓扑 roles 与 frontmatter 不一致: %s vs %s" % (troles, {rid: r["modules"] for rid, r in roles.items()}))

        tmgmt = [m.group(1) for m in (re.match(r"^\s{2}- (\S+)$", ln) for ln in segs.get("management", [])) if m]
        if len(tmgmt) != len(set(tmgmt)):
            errors.append("拓扑 management 有重复角色")
        if set(tmgmt) != {"convener"} | set(roles):
            errors.append("拓扑 management 应为 convener + 全部项目角色: %s" % tmgmt)

    # 路径重叠/嵌套
    paths = []
    for mid, mod in snap.items():
        if "path" in mod:
            paths.append((mid, mod["path"]))
        for p in mod.get("_list", []):
            if p.endswith("/") or "/" in p or p.endswith((".html", ".cmd", ".json", ".js", ".css", ".md")):
                paths.append((mid, p))
    dirs = [(mid, p) for mid, p in paths if p.endswith("/")]
    files = [(mid, p) for mid, p in paths if not p.endswith("/")]
    for i, (mid, p) in enumerate(paths):
        for mid2, p2 in paths[i + 1:]:
            if mid != mid2 and (p.rstrip("/") == p2.rstrip("/") or p2.startswith(p.rstrip("/") + "/") or p.startswith(p2.rstrip("/") + "/")):
                errors.append("路径重叠: %s(%s) 与 %s(%s)" % (mid, p, mid2, p2))
    if any(mid in ("env-resources", "entry-index") for mid in snap):
        cat = {mid: snap[mid].get("category") for mid in snap}
        if cat.get("env-resources") != "env":
            errors.append("env-resources category=%s" % cat.get("env-resources"))
        if cat.get("entry-index") != "entry":
            errors.append("entry-index category=%s" % cat.get("entry-index"))
        eb = re.search(r"envBootstrap:\s*\n\s+omitted:\s*(\w+)", rfm)
        if eb and eb.group(1) == "true":
            errors.append("envBootstrap omitted=true 但含 env/entry 模块")

    print("modules(auth)=%d modules(snap)=%d roles=%d paths=%d" % (len(auth), len(snap), len(roles), len(paths)))
    print("owners:", ", ".join("%s->%s" % (k, v[0]) for k, v in sorted(owners.items())))
    if errors:
        print("FAIL")
        for e in errors:
            print(" -", e)
        return 1
    print("OK: roster v6 结构自检通过（模块快照一致、单一属主、management/拓扑一致、路径无重叠）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
