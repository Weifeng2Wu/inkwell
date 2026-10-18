"""Whole-project checks: locate or build the paper PDF, inspect figures, scan the folder for identity leaks."""
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .common import finding, sources, Finding
from . import check_pdf

IMG_EXT = [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg", ".gif"]
INCL_RE = re.compile(r"\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}")
GPATH_RE = re.compile(r"\\graphicspath\s*\{((?:\{[^}]*\})+)\}")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
TEXT_EXT = {".tex", ".bib", ".bbl", ".txt", ".md", ".cls", ".sty", ".bst", ".cfg", ".yml", ".yaml", ".json", ".csv"}
SKIP_DIRS = {".git", "__MACOSX", "node_modules", ".venv"}
# paths such as /Users/<name>/ or /home/<name>/ inside aux/log files expose the author's account name
HOME_RE = re.compile(r"(?:/Users/|/home/|C:\\Users\\)([A-Za-z0-9._-]+)")


def _files(root):
    for p in Path(root).rglob("*"):
        if p.is_file() and not (set(p.relative_to(root).parts) & SKIP_DIRS):
            yield p


def figure_targets(src):
    """[(name_in_tex, resolved_path|None, 'file:line')] for every \\includegraphics."""
    dirs = [""]
    m = GPATH_RE.search(src.clean)
    if m:
        dirs += re.findall(r"\{([^}]*)\}", m.group(1))
    out = []
    for m in INCL_RE.finditer(src.clean):
        name = m.group(1).strip()
        found = None
        for d in dirs:
            base = src.base / d / name
            for c in [base] + [Path(str(base) + e) for e in IMG_EXT]:
                if c.is_file():
                    found = c
                    break
            if found:
                break
        out.append((name, found, src.where(m.start())))
    return out


def find_paper_pdf(root, src):
    figs = {f.resolve() for _, f, _ in figure_targets(src) if f}
    cands = [p for p in _files(root) if p.suffix.lower() == ".pdf" and p.resolve() not in figs]
    if not cands:
        return None, []
    pref = [p for p in cands if p.stem == src.main.stem]
    pick = (pref or sorted(cands, key=lambda p: -p.stat().st_mtime))[0]
    return pick, [p for p in cands if p != pick]


def compile_project(root, main, timeout=300):
    """Compile a COPY of the project (the upload folder may be read-only). Returns (pdf_path|None, log_tail)."""
    tmp = Path(tempfile.mkdtemp(prefix="paper_build_"))
    dst = tmp / "proj"
    shutil.copytree(root, dst, ignore=shutil.ignore_patterns(".git", "__MACOSX"))
    rel = Path(main).resolve().relative_to(Path(root).resolve())
    cwd = (dst / rel).parent
    tex = rel.name
    log = ""
    try:
        if shutil.which("latexmk"):
            r = subprocess.run(["latexmk", "-pdf", "-interaction=nonstopmode", "-halt-on-error", tex], cwd=cwd,
                               capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
            log = (r.stdout or "")[-1500:] + (r.stderr or "")[-500:]
        else:
            stem = Path(tex).stem
            steps = [["pdflatex", "-interaction=nonstopmode", tex]]
            if re.search(r"\\bibliography\s*\{", Path(main).read_text(errors="ignore")):
                steps += [["bibtex", stem]]
            steps += [["pdflatex", "-interaction=nonstopmode", tex]] * 2
            for cmd in steps:
                r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
                log = (r.stdout or "")[-1500:]
    except Exception as e:  # missing tool, timeout
        log = f"compile failed: {e}"
    pdf = cwd / (Path(tex).stem + ".pdf")
    return (pdf if pdf.exists() else None), log


def run(root, src, pdf_path, rules, names=None, compiled=False):
    """Folder-level findings. `src` is a check_tex.Source for the project."""
    P = rules.get("pdf") or {}
    S = sources(P)
    names = names or []
    F = []
    root = Path(root)

    # --- stale PDF -------------------------------------------------------
    if pdf_path and not compiled:
        srcs = [p for p in _files(root) if p.suffix.lower() in (".tex", ".bib", ".sty", ".cls", ".bst")]
        if srcs:
            newest = max(p.stat().st_mtime for p in srcs)
            pm = Path(pdf_path).stat().st_mtime
            F.append(finding("proj.pdf_fresh", pm >= newest - 2, "PDF is newer than all sources",
                             "" if pm >= newest - 2 else f"{Path(pdf_path).name} is older than "
                             f"{max(srcs, key=lambda p: p.stat().st_mtime).name}: the PDF may not reflect the current source.",
                             fix="Recompile (latexmk -pdf main.tex) and re-run the check on the fresh PDF, or let the checker compile a copy.",
                             severity="warn"))

    # --- figures ---------------------------------------------------------
    targets = figure_targets(src)
    if targets:
        missing = [f"{n} ({w})" for n, f, w in targets if f is None]
        F.append(finding("proj.figures_exist", not missing, "Every \\includegraphics file exists",
                         "" if not missing else "Missing: " + "; ".join(missing[:10]),
                         fix="Add the file, fix the path/case (Linux is case-sensitive; arXiv/OpenReview build on Linux) or remove the line."))
        FO = P.get("fonts") or {}
        bad, checked = [], 0
        for n, f, w in targets:
            if f and f.suffix.lower() == ".pdf":
                rows = check_pdf._pdffonts(str(f))
                if rows is None:
                    break
                checked += 1
                issues = []
                if FO.get("require_embedded", False) and any(not r["emb"] for r in rows):
                    issues.append("non-embedded fonts " + ", ".join(sorted({r["name"] for r in rows if not r["emb"]})[:3]))
                if FO.get("forbid_type3") and any(r["type"].lower().startswith("type 3") for r in rows):
                    issues.append("Type 3 fonts")
                if issues:
                    bad.append(f"{f.name} ({w}): " + "; ".join(issues))
        if checked:
            F.append(finding("proj.figure_fonts", not bad, "Figure PDFs use embedded fonts" +
                             (" and no Type 3" if FO.get("forbid_type3") else ""),
                             "" if not bad else f"{len(bad)} figure(s): " + " | ".join(bad[:8]),
                             fix="Re-export these figures: matplotlib `rcParams['pdf.fonttype']=42` (and `ps.fonttype`); "
                                 "Illustrator/Inkscape: embed all fonts or convert text to outlines; draw.io: export PDF with 'embed fonts'. "
                                 "Verify with `pdffonts fig.pdf`.",
                             source=S.get("fonts", "")))

    # --- anonymity hygiene across the folder ------------------------------
    A = rules.get("anonymity") or {}
    if A.get("required"):
        official = set(((rules.get("tex") or {}).get("official_files") or {}).keys())
        leaks = []
        for p in _files(root):
            rel = p.relative_to(root)
            if p.name in official or p.name == ".DS_Store":
                continue
            if p.suffix.lower() in TEXT_EXT and p.stat().st_size < 3_000_000:
                txt = p.read_text(errors="ignore")
                for nm in names:
                    if nm and nm.lower() in txt.lower():
                        leaks.append(f"{rel}: contains '{nm}'")
                if p.suffix.lower() in (".bib", ".txt", ".md", ".csv", ".json"):
                    for m in EMAIL_RE.finditer(txt):
                        leaks.append(f"{rel}: email {m.group(0)}")
            elif p.suffix.lower() in (".aux", ".log", ".fls", ".out", ".toc") and p.stat().st_size < 3_000_000:
                m = HOME_RE.search(p.read_text(errors="ignore"))
                if m:
                    leaks.append(f"{rel}: local path reveals account name '{m.group(1)}'")
        if (root / ".git").exists():
            leaks.append(".git/ folder present (commit history contains author names/emails)")
        for n, f, w in targets:
            if f and f.suffix.lower() == ".pdf":
                try:
                    import pdfplumber
                    with pdfplumber.open(f) as pdf:
                        meta = " ".join(str(v) for v in (pdf.metadata or {}).values())
                    for nm in names:
                        if nm and nm.lower() in meta.lower():
                            leaks.append(f"{f.name}: PDF metadata contains '{nm}'")
                except Exception:
                    pass
        F.append(finding("proj.anon_folder", not leaks, "No identity leaks in the rest of the project folder",
                         "" if not leaks else f"{len(leaks)}: " + "; ".join(leaks[:12]),
                         fix="Delete .git/ and build artefacts (aux/log/fls) before sharing; clean names/emails from .bib/.txt; "
                             "re-export figures whose metadata names you. Only submit what the venue asks for (usually just the PDF).",
                         source=sources(A).get("required", "")))

    # --- hygiene: multiple main files ------------------------------------
    mains = []
    for f in root.rglob("*.tex"):
        if set(f.relative_to(root).parts) & SKIP_DIRS:
            continue
        if re.search(r"\\documentclass", "\n".join(l.split("%")[0] for l in f.read_text(errors="ignore").splitlines())):
            mains.append(str(f.relative_to(root)))
    if len(mains) > 1:
        F.append(Finding("proj.multiple_mains", "skip", "Several .tex files contain \\documentclass",
                         f"Checked {src.main.relative_to(root) if root in src.main.parents else src.main.name}; others: "
                         + ", ".join(m for m in mains if m != str(src.main.relative_to(root)))[:300]
                         + ". Use --main FILE if the wrong one was picked."))
    return F
