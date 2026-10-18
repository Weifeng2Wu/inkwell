#!/usr/bin/env python3
"""Assemble a venue-specific format-check skill.

  python scripts/build_venue_skill.py --name acl-2027-format-check --rules rules.json --out /home/claude/skills \
      [--inventory kit_text/inventory.json] [--kit-notes kit_notes.md] [--description "..."]

Creates <out>/<name>/ with SKILL.md, rules.json, scripts/ (generic engine), assets/official/ (kit style files whose
hashes the engine compares against) and references/kit_notes.md.
"""
import argparse
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path
from string import Template

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
KNOWN_TOP = {"venue", "year", "default_phase", "phases", "pdf", "tex", "docx", "anonymity", "checklist", "_notes"}


def lint(rules):
    w = []
    if not rules.get("venue"):
        w.append("rules.venue is missing")
    for blk in ("pdf", "tex", "docx", "anonymity"):
        b = rules.get(blk)
        if b and not b.get("_sources"):
            w.append(f"{blk}: no _sources, rules cannot be traced back to the kit")
    P = rules.get("pdf") or {}
    if P.get("margins") and not all(k in P["margins"] for k in ("top", "bottom", "left", "right")):
        w.append("pdf.margins needs top/bottom/left/right (+ unit); convert a text-block size into margins")
    if P.get("page_limit", {}).get("main_body") is not None and not P["page_limit"].get("main_body_ends_at"):
        w.append("pdf.page_limit.main_body is set but main_body_ends_at (heading regexes) is empty")
    for it in rules.get("checklist", []):
        for k in ("id", "title", "source"):
            if not it.get(k):
                w.append(f"checklist item {it.get('id', '?')}: missing '{k}'")
    for k in rules:
        if k not in KNOWN_TOP:
            w.append(f"unknown top-level key '{k}' (ignored by the engine)")
    for ph in (rules.get("phases") or {}):
        if ph not in ("review", "final", "camera-ready", "preprint", "rebuttal") and not isinstance(rules["phases"][ph], dict):
            w.append(f"phase '{ph}' should be an object of overrides")
    if rules.get("default_phase") and rules["default_phase"] not in (rules.get("phases") or {}):
        w.append(f"default_phase '{rules['default_phase']}' is not defined in phases")
    return w


def summarize(rules):
    L = []
    P, T, D, A = (rules.get(k) or {} for k in ("pdf", "tex", "docx", "anonymity"))
    ps = P.get("_sources", {})

    def add(label, key, srcs):
        L.append(f"- {label}" + (f"  \u2014 _{srcs[key]}_" if srcs.get(key) else ""))

    if P.get("page_size"):
        add(f"Paper size {P['page_size']}", "page_size", ps)
    pl = P.get("page_limit") or {}
    if pl.get("main_body") is not None:
        add(f"Main body at most {pl['main_body']} pages (ends at: {', '.join(pl.get('main_body_ends_at', []))})", "page_limit", ps)
    if pl.get("total") is not None:
        add(f"At most {pl['total']} pages in total", "page_limit", ps)
    if P.get("margins"):
        m = P["margins"]
        add(f"Margins T{m.get('top')} B{m.get('bottom')} L{m.get('left')} R{m.get('right')} {m.get('unit', 'in')}", "margins", ps)
    fo = P.get("fonts") or {}
    if fo:
        bits = []
        if fo.get("allowed_families"):
            bits.append("fonts " + "/".join(fo["allowed_families"]))
        if fo.get("body_size_pt"):
            bits.append(f"body {fo['body_size_pt']} pt")
        if fo.get("min_size_pt"):
            bits.append(f"min {fo['min_size_pt']} pt")
        if fo.get("require_embedded", False):
            bits.append("embedded fonts")
        if fo.get("forbid_type3"):
            bits.append("no Type 3")
        add(", ".join(bits), "fonts", ps)
    if P.get("line_numbers"):
        add(f"Line numbers {P['line_numbers']}", "line_numbers", ps)
    if A.get("required"):
        add("Anonymity of PDF and source (metadata, emails, links, acknowledgements, author names you provide)", "required", A.get("_sources", {}))
    ts = T.get("_sources", {})
    if T.get("documentclass"):
        add(f"\\documentclass {T['documentclass'].get('name', '')}"
            f"{T['documentclass'].get('options_required', '')}", "documentclass", ts)
    for r in T.get("packages_required", []):
        r = {"name": r} if isinstance(r, str) else r
        add(f"Package {r['name']} {r.get('options_required', '')}", "packages_required", ts)
    if T.get("bibliography_style"):
        add(f"Bibliography style {', '.join(T['bibliography_style'])}", "bibliography_style", ts)
    if T.get("official_files"):
        add("Official style files unmodified: " + ", ".join(T["official_files"]), "official_files", ts)
    if T.get("forbid_layout_hacks", False):
        L.append("- No spacing/margin hacks (negative \\vspace, \\geometry, \\baselinestretch, savetrees/fullpage/...)")
    if D:
        add("Word document: page size, margins, fonts, spacing", "page_size", D.get("_sources", {}))
    for it in rules.get("checklist", []):
        auto = "auto-detected" if it.get("detect") else "manual"
        L.append(f"- Checklist: {it['title']} ({auto}; {it.get('severity', 'error')}) \u2014 _{it.get('source', '')}_")
    return "\n".join(L) or "- (no rules)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--inventory")
    ap.add_argument("--kit-notes")
    ap.add_argument("--description")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", a.name):
        sys.exit("--name must be lowercase letters, digits and hyphens")
    rules = json.loads(Path(a.rules).read_text(encoding="utf-8"))
    warnings = lint(rules)

    dest = Path(a.out) / a.name
    if dest.exists():
        if not a.force:
            sys.exit(f"{dest} exists (use --force to overwrite)")
        shutil.rmtree(dest)
    (dest / "scripts").mkdir(parents=True)
    shutil.copy(HERE / "run_checks.py", dest / "scripts" / "run_checks.py")
    shutil.copytree(HERE / "checks", dest / "scripts" / "checks", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

    # official style files: fill hashes + keep a copy for diffs
    off = (rules.get("tex") or {}).get("official_files") or {}
    if off:
        inv = json.loads(Path(a.inventory).read_text()) if a.inventory else []
        by_name = {r["name"]: r for r in inv}
        (dest / "assets" / "official").mkdir(parents=True)
        for fname in list(off):
            rec = by_name.get(fname)
            if not rec:
                warnings.append(f"official file {fname} not found in inventory; removed from rules")
                del off[fname]
                continue
            off[fname] = {"sha256": rec["sha256"]}
            shutil.copy(rec["path"], dest / "assets" / "official" / fname)
    (dest / "rules.json").write_text(json.dumps(rules, indent=2, ensure_ascii=False), encoding="utf-8")

    (dest / "references").mkdir()
    if a.kit_notes and Path(a.kit_notes).exists():
        shutil.copy(a.kit_notes, dest / "references" / "kit_notes.md")

    venue = rules.get("venue", a.name)
    phases = list((rules.get("phases") or {}).keys())
    desc = a.description or (
        f"Check a paper against the {venue} author kit before submission: page limit, margins, fonts, anonymity, style-file integrity, "
        f"forbidden LaTeX hacks and the required checklist items, with concrete fixes. Use whenever the user is preparing, "
        f"proofreading or about to submit a paper to {venue}, mentions its formatting requirements, desk rejection, anonymization or "
        f"camera-ready, or asks to 'check the format' of a PDF/LaTeX/Word paper for this venue, even without naming the skill. "
        f"\u7528\u4e8e{venue}\u6295\u7a3f\u524d\u7684\u683c\u5f0f\u68c0\u67e5\u3001\u6392\u7248\u68c0\u67e5\u3001\u533f\u540d\u5316\u68c0\u67e5\u3001camera-ready \u5b9a\u7a3f\u3002")
    text = Template((ROOT / "assets" / "venue_skill_template.md").read_text(encoding="utf-8")).substitute(
        name=a.name, description=json.dumps(desc.replace("\n", " "), ensure_ascii=False), venue=venue, date=date.today().isoformat(),
        phases_line=(" / ".join(phases) + "." if phases else "(single phase)."),
        default_phase=rules.get("default_phase") or (phases[0] if phases else "review"),
        rule_summary=summarize(rules))
    (dest / "SKILL.md").write_text(text, encoding="utf-8")

    print(f"built {dest}")
    for w_ in warnings:
        print("WARNING:", w_)
    return 0


if __name__ == "__main__":
    sys.exit(main())
