#!/usr/bin/env python3
"""Read-only final acceptance checks for wuxia-rogue-v2.

Run with the project's local venv (PIL available):
  tools/art/venv/Scripts/python.exe -I docs/verification/wuxia-rogue-v2-final-check.py

Does not write to implementation directories. It only reads files and prints
a JSON summary plus a short human-readable report.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FAILS = []
NOTES = []


def fail(msg):
    FAILS.append(msg)


def sha256_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read_text(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


SPRITE_IDS = {
    'player', 'monster-wanderer', 'monster-bowman', 'monster-blade',
    'weapon-sword', 'weapon-blade', 'weapon-needle',
    'drop-potion', 'drop-silver', 'drop-xp',
}
BACKGROUND_IDS = {
    'title-bg', 'ui-result', 'ui-scroll', 'ui-stele',
    'sect-jianzong', 'sect-daomen', 'sect-yigu',
}
EXPECTED_SCRIPTS = [
    'src/core/config.js',
    'src/core/rng.js',
    'src/core/pool.js',
    'src/core/spatial-hash.js',
    'src/core/input.js',
    'src/core/camera.js',
    'src/core/bus.js',
    'src/core/loop.js',
    'src/loot/tables.js',
    'src/loot/progression.js',
    'src/loot/pickup.js',
    'src/sects/defs.js',
    'src/sects/upgrades.js',
    'src/sects/selection.js',
    'src/combat/player.js',
    'src/combat/auto-attack.js',
    'src/monsters/types.js',
    'src/monsters/ai.js',
    'src/monsters/director.js',
    'src/fx/particles.js',
    'src/fx/damage-numbers.js',
    'src/fx/screen-fx.js',
    'src/ui/hud.js',
    'src/ui/screens.js',
    'src/ui/overlays.js',
    'src/core/main.js',
]


def parse_sources():
    rows = {}
    for line in read_text('assets/generated/SOURCES.md').splitlines():
        if not line.startswith('|'):
            continue
        cols = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cols) < 10:
            continue
        if cols[0] in ('#', '---') or not cols[0].isdigit():
            continue
        try:
            idx = int(cols[0])
        except ValueError:
            continue
        asset_id = cols[1].strip('`')
        path = cols[3].strip('`')
        size = cols[4]
        status = cols[6].replace('*', '').strip()
        try:
            size_bytes = int(cols[7])
            digest = cols[8].strip('`')
        except (ValueError, IndexError):
            fail(f'SOURCES row {idx} malformed')
            continue
        rows[asset_id] = {
            'index': idx,
            'path': path,
            'size': size,
            'status': status,
            'bytes': size_bytes,
            'sha256': digest,
        }
    return rows


def check_assets():
    from PIL import Image

    sources = parse_sources()
    manifest = json.loads(read_text('tools/art/MANIFEST.json'))
    assets = manifest.get('assets', [])
    manifest_ids = [a.get('id') for a in assets]
    if len(assets) != 17:
        fail(f'MANIFEST assets count {len(assets)}, want 17')
    if set(manifest_ids) != SPRITE_IDS | BACKGROUND_IDS:
        fail('MANIFEST id set differs from expected 17 ids')
    if set(sources) != set(manifest_ids):
        fail(f'SOURCES id set differs from MANIFEST: {sorted(set(sources) ^ set(manifest_ids))}')
    if any(a.get('status') != 'ok' for a in assets):
        fail('MANIFEST has non-ok asset')

    manifest_by_id = {a['id']: a for a in assets}
    detail = {}
    for asset_id in sorted(SPRITE_IDS | BACKGROUND_IDS):
        rel = f'assets/generated/{asset_id}.webp'
        path = ROOT / rel
        src = sources.get(asset_id)
        if not path.exists():
            fail(f'missing WebP: {rel}')
            continue
        actual_bytes = path.stat().st_size
        actual_sha = sha256_file(path)
        if src:
            if actual_bytes != src['bytes']:
                fail(f'{asset_id}: bytes {actual_bytes} != SOURCES {src["bytes"]}')
            if actual_sha != src['sha256']:
                fail(f'{asset_id}: sha256 mismatch')
            if src['path'] != rel:
                fail(f'{asset_id}: SOURCES path {src["path"]} != {rel}')
            if src['status'] != 'ok':
                fail(f'{asset_id}: SOURCES status {src["status"]}')
        else:
            fail(f'{asset_id}: absent from SOURCES')

        try:
            with Image.open(path) as im:
                im.load()
                mode = im.mode
                width, height = im.size
                has_alpha = 'A' in im.getbands()
                corner = []
                zero = 0
                total = width * height
                if has_alpha:
                    px = im.convert('RGBA')
                    pts = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
                    corner = [px.getpixel(p)[3] for p in pts]
                    zero = sum(1 for v in px.getdata() if v[3] == 0)
                expected = 'RGBA' if asset_id in SPRITE_IDS else 'RGB'
                if has_alpha != (expected == 'RGBA'):
                    fail(f'{asset_id}: alpha presence {has_alpha}, want {expected}')
                if asset_id in SPRITE_IDS and corner and any(v != 0 for v in corner):
                    fail(f'{asset_id}: corner alpha {corner}, want all 0')
                if asset_id in BACKGROUND_IDS and has_alpha and any(v != 255 for v in corner):
                    fail(f'{asset_id}: background corner alpha {corner}, want all 255')
                if src:
                    expect_w, expect_h = [int(x) for x in src['size'].replace('×', 'x').split('x')]
                    if (width, height) != (expect_w, expect_h):
                        fail(f'{asset_id}: dimensions {width}x{height} != {expect_w}x{expect_h}')
                detail[asset_id] = {
                    'bytes': actual_bytes,
                    'sha256': actual_sha,
                    'mode': mode,
                    'size': f'{width}x{height}',
                    'corner_alpha': corner,
                    'alpha0_ratio': (zero / total) if total else 0,
                }
                # source PNG dimension parity
                m = manifest_by_id.get(asset_id, {})
                png_rel = m.get('file', '')
                if png_rel:
                    png = ROOT / 'tools/art' / png_rel
                    if not png.exists():
                        fail(f'{asset_id}: source PNG missing {png_rel}')
                    else:
                        with Image.open(png) as sim:
                            sim.load()
                            if sim.size != (width, height):
                                fail(f'{asset_id}: source PNG {sim.size} != WebP {(width, height)}')
        except Exception as exc:
            fail(f'{asset_id}: decode failed: {exc}')

    # placeholders required by the bridge
    for asset_id in sorted(SPRITE_IDS | BACKGROUND_IDS | {'sword-qi'}):
        ph = ROOT / f'assets/placeholder-{asset_id}.svg'
        if not ph.exists():
            fail(f'missing placeholder: assets/placeholder-{asset_id}.svg')
        else:
            text = ph.read_text(encoding='utf-8', errors='replace')
            # xmlns="http://www.w3.org/2000/svg" is a namespace identifier, not
            # a network reference. Flag only actual external resource links.
            external_ref = re.search(
                r'(?:href|src)\s*=\s*["\']https?://|url\(\s*["\']?https?://',
                text,
                re.I,
            )
            if external_ref:
                fail(f'{ph.name}: contains external reference')
            if ph.stat().st_size > 50 * 1024:
                fail(f'{ph.name}: >50KB')

    return {
        'sources_count': len(sources),
        'manifest_count': len(assets),
        'manifest_generated_at': manifest.get('generatedAt'),
        'manifest_ids': manifest_ids,
        'assets': detail,
    }


def check_index():
    text = read_text('index.html')
    scripts = re.findall(r'<script\b([^>]*)>(.*?)</script>', text, re.I | re.S)
    external = []
    inline = []
    for attrs, body in scripts:
        srcm = re.search(r'\bsrc\s*=\s*["\']([^"\']+)["\']', attrs, re.I)
        has_defer = re.search(r'\bdefer\b', attrs, re.I) is not None
        if srcm:
            external.append({'src': srcm.group(1), 'defer': has_defer})
        if body.strip():
            inline.append(body.strip()[:80])
    if len(external) != 27:
        fail(f'index external scripts {len(external)}, want 27')
    if inline:
        fail(f'index inline scripts {len(inline)}, want 0')
    if any(not s['defer'] for s in external):
        fail('index has non-defer external script')
    srcs = [s['src'] for s in external]
    if srcs[:26] != EXPECTED_SCRIPTS:
        fail('index first 26 scripts differ from architecture §3.2')
    if len(srcs) != 27 or srcs[26] != 'tests/perf.js':
        fail('index 27th script is not tests/perf.js')
    return {
        'sha256': sha256_file(ROOT / 'index.html'),
        'external_count': len(external),
        'inline_count': len(inline),
        'defer_count': sum(1 for s in external if s['defer']),
        'first_26_match_architecture': srcs[:26] == EXPECTED_SCRIPTS,
        'last_script': srcs[-1] if srcs else None,
    }


def check_src_static():
    files = sorted((ROOT / 'src').rglob('*.js'))
    remote = []
    tools_ref = []
    network_api = []
    for p in files:
        text = p.read_text(encoding='utf-8', errors='replace')
        rel = p.relative_to(ROOT).as_posix()
        if re.search(r'https?://', text, re.I):
            remote.append(rel)
        if 'tools/art' in text:
            tools_ref.append(rel)
        if re.search(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(', text):
            network_api.append(rel)
    if remote:
        fail(f'src remote URLs: {remote}')
    if tools_ref:
        fail(f'src tools/art refs: {tools_ref}')
    if network_api:
        fail(f'src network API refs: {network_api}')

    # Static transparency assertions for the choice overlay.
    overlays = read_text('src/ui/overlays.js')
    transparency = {
        'choice_class': '.overlay--choice' in overlays,
        'choice_background_transparent': 'overlay.overlay--choice{background:transparent' in overlays,
        'choice_panel_transparent': '.overlay--choice .overlay__panel{background:transparent' in overlays,
        'choice_does_not_request_bg': "if (!isChoice) {\n      addImage(wrapper, 'assets/generated/ui-stele.webp', 'overlay__bg');" in overlays,
        'choice_no_ui_scroll_reference': 'ui-scroll' not in overlays,
        'sect_uses_ui_stele': "assets/generated/ui-stele.webp" in overlays,
    }
    for k, v in transparency.items():
        if not v:
            fail(f'overlay transparency check failed: {k}')

    # Loading chain / caps / degradation source assertions.
    fx = read_text('src/fx/screen-fx.js')
    fx_checks = {
        'generated_path': "ASSET_GENERATED = 'assets/generated/'" in fx,
        'placeholder_path': "ASSET_PLACEHOLDER = 'assets/placeholder-'" in fx,
        'stage_fallback_once': 'if (rec.stage === 0)' in fx and 'markAssetMissing(rec)' in fx,
        'drawimage_guard': 'typeof ctx.drawImage !==' in fx,
        'spark_cap_32': 'var SPARK_CAP = 32;' in fx,
        'dissolve_cap_16': 'var DISSOLVE_CAP = 16;' in fx,
        'degrade_only_in_update': 'setDegrade(true)' in fx and 'updateDegrade' in fx,
        'choice_skill_fx': 'normalizeChoiceSkill' in fx,
    }
    for k, v in fx_checks.items():
        if not v:
            fail(f'fx source check failed: {k}')

    # Gameplay module asset integration markers.
    integration = {
        'combat_player': "'player'" in read_text('src/combat/auto-attack.js'),
        'combat_weapon_map': 'WEAPON_BY_SECT' in read_text('src/combat/auto-attack.js'),
        'monster_map': 'ASSET_BY_TYPE' in read_text('src/monsters/ai.js'),
        'loot_map': 'ASSET_IDS' in read_text('src/loot/pickup.js'),
        'screens_images': 'title-bg.webp' in read_text('src/ui/screens.js') and 'ui-result.webp' in read_text('src/ui/screens.js'),
        'dom_error_chain': 'addEventListener(\'error\'' in read_text('src/ui/screens.js') and 'addEventListener(\'error\'' in read_text('src/ui/overlays.js'),
    }
    for k, v in integration.items():
        if not v:
            fail(f'integration source check failed: {k}')

    # Generated-asset reference audit. Static literal references only; sect-*
    # are constructed dynamically in screens/overlays, so they are reported
    # separately. ui-scroll is intentionally not used by the transparent choice
    # overlay; surface it rather than hiding it.
    all_text = '\n'.join(
        p.read_text(encoding='utf-8', errors='replace')
        for p in files
    ) + '\n' + read_text('styles/theme.css') + '\n' + read_text('index.html')
    refs = {}
    for asset_id in sorted(SPRITE_IDS | BACKGROUND_IDS | {'sword-qi'}):
        refs[asset_id] = all_text.count(asset_id)

    # Non-card static scan.
    card_hits = []
    pattern = re.compile(r'\b(?:card|cards|deck|decks|hand|hands)\b', re.I)
    for p in files:
        rel = p.relative_to(ROOT).as_posix()
        for i, line in enumerate(p.read_text(encoding='utf-8', errors='replace').splitlines(), 1):
            if pattern.search(line):
                card_hits.append(f'{rel}:{i}:{line.strip()[:100]}')
    if card_hits:
        fail(f'card/deck/hand hits: {card_hits[:5]}')

    return {
        'js_count': len(files),
        'remote_url_files': remote,
        'tools_art_files': tools_ref,
        'network_api_files': network_api,
        'overlay_transparency': transparency,
        'fx_checks': fx_checks,
        'integration': integration,
        'asset_reference_counts': refs,
        'card_hits': card_hits,
    }


def main():
    from PIL import Image  # noqa: F401 (import check with venv)
    result = {
        'root': str(ROOT),
        'index': check_index(),
        'assets': check_assets(),
        'src_static': check_src_static(),
    }
    result['failures'] = FAILS
    result['pass'] = not FAILS
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not FAILS else 1


if __name__ == '__main__':
    sys.exit(main())
