"""LaTeX source checks. Input: a .tex file, a directory, or a .zip of the project."""
import bisect
import difflib
import re
import tempfile
import zipfile
from pathlib import Path

from .common import finding, sources, sha256_normalized, Finding

COMMENT_RE = re.compile(r"(?<!\\)%.*$")
INPUT_RE = re.compile(r"\\(?:input|include|subfile)\s*\{([^}]+)\}")
USEPKG_RE = re.compile(r"\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}")
DOCCLASS_RE = re.compile(r"\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")

# Typical "squeeze the page limit" tricks. Severity is configurable via tex.layout_hacks_severity.
LAYOUT_HACKS = [
    (r"\\vspace\*?\s*\{\s*-", "negative \\vspace (squeezes spacing)",
     "Delete it. If the page limit is the problem, cut text or shrink figures instead."),
    (r"\\vskip\s*-", "negative \\vskip", "Delete it; cut content instead."),
    (r"\\(baselinestretch|linespread|setstretch)", "line spacing override",
     "Remove it; line spacing is fixed by the official style."),
    (r"\\(?:set|add)length\s*\{\s*\\(textwidth|textheight|oddsidemargin|evensidemargin|topmargin|headheight|"
     r"columnsep|parskip|parindent|textfloatsep|floatsep|intextsep|abovecaptionskip|belowcaptionskip|"
     r"abovedisplayskip|belowdisplayskip)\s*\}", "page/spacing length override",
     "Remove it unless the venue explicitly allows adjusting this length."),
    (r"\\fontsize\s*\{", "manual \\fontsize", "Remove it and use the template's size commands."),
    (r"\\(?:geometry|newgeometry)\s*\{", "geometry override", "Remove it; margins come from the official style."),
    (r"\\looseness\s*=?\s*-", "negative \\looseness", "Remove it; rewrite the paragraph if you need to save a line."),
    (r"\\enlargethispage", "\\enlargethispage", "Remove it; it extends the text block."),
    (r"\\(?:titlespacing|titleformat)", "section title spacing override", "Remove it; headings follow the template."),
]
DEFAULT_FORBIDDEN_PACKAGES = ["savetrees", "fullpage", "setspace", "titlesec"]


class Source:
    def __init__(self, path, main=None):
        p = Path(path)
        self.tmp = None
        if p.suffix.lower() == ".zip":
            self.tmp = tempfile.mkdtemp(prefix="tex_")
            zipfile.ZipFile(p).extractall(self.tmp)
            root = Path(self.tmp)
        elif p.is_dir():
            root = p
        else:
            root = p.parent
        self.root = root
        if main:
            m = Path(main)
            self.main = m if m.is_absolute() else root / m
            if not self.main.is_file():
                raise FileNotFoundError(f"--main {main} not found under {root}")
        else:
            self.main = p if p.is_file() and p.suffix.lower() == ".tex" else self._find_main(root)
        self.base = self.main.parent
        self.lines = []       # (relpath, lineno, cleaned, raw)
        self._load(self.main, set())
        self.clean = "\n".join(l[2] for l in self.lines)
        self.offsets, off = [], 0
        for l in self.lines:
            self.offsets.append(off)
            off += len(l[2]) + 1

    def _find_main(self, root):
        cands = []
        for f in root.rglob("*.tex"):
            try:
                t = f.read_text(errors="ignore")
            except Exception:
                continue
            if DOCCLASS_RE.search("\n".join(COMMENT_RE.sub("", x) for x in t.splitlines())):
                cands.append(f)
        if not cands:
            raise FileNotFoundError("no .tex file with \\documentclass found")
        pref = [c for c in cands if c.name.lower() in ("main.tex", "paper.tex", "ms.tex", "anonymous.tex")]
        return (pref or sorted(cands, key=lambda c: -c.stat().st_size))[0]

    def _load(self, f, seen):
        if f in seen or not f.exists():
            return
        seen.add(f)
        rel = str(f.relative_to(self.root)) if self.root in f.parents else f.name
        for i, raw in enumerate(f.read_text(errors="ignore").splitlines(), 1):
            clean = COMMENT_RE.sub("", raw)
            self.lines.append((rel, i, clean, raw))
            for m in INPUT_RE.finditer(clean):
                tgt = m.group(1).strip()
                for cand in (self.base / tgt, self.base / (tgt + ".tex")):
                    if cand.is_file():
                        self._load(cand, seen)
                        break

    def where(self, offset):
        i = max(0, bisect.bisect_right(self.offsets, offset) - 1)
        rel, ln, _, _ = self.lines[i]
        return f"{rel}:{ln}"


def _opts(s):
    return [o.strip() for o in (s or "").split(",") if o.strip()]


def run(path, rules, names=None, main=None):
    T = rules.get("tex", {}) or {}
    S = sources(T)
    names = names or []
    F = []
    src = Source(path, main)
    F.append(Finding("tex.main", "skip", "Main file detected", f"{src.main.name} (+{len(src.lines)} source lines)"))

    # ---- documentclass ------------------------------------------------
    DC = T.get("documentclass")
    if DC:
        m = DOCCLASS_RE.search(src.clean)
        if not m:
            F.append(finding("tex.documentclass", False, "\\documentclass found", "No \\documentclass in the source"))
        else:
            opts, name = _opts(m.group(1)), m.group(2).strip()
            probs = []
            if DC.get("name") and name != DC["name"]:
                probs.append(f"class is '{name}', expected '{DC['name']}'")
            probs += [f"missing option '{o}'" for o in DC.get("options_required", []) if o not in opts]
            probs += [f"forbidden option '{o}'" for o in DC.get("options_forbidden", []) if o in opts]
            want = f"\\documentclass[{','.join(DC.get('options_required', []))}]{{{DC.get('name', name)}}}"
            F.append(finding("tex.documentclass", not probs, "\\documentclass matches the template",
                             "; ".join(probs), location=src.where(m.start()),
                             fix=f"Use: {want}", source=S.get("documentclass", "")))

    # ---- packages -----------------------------------------------------
    used = {}   # name -> (options, location)
    for m in USEPKG_RE.finditer(src.clean):
        for pk in _opts(m.group(2)):
            used[pk] = (_opts(m.group(1)), src.where(m.start()))
    for req in T.get("packages_required", []):
        req = {"name": req} if isinstance(req, str) else req
        nm = req["name"]
        if nm not in used:
            F.append(finding(f"tex.pkg.{nm}", False, f"Required package '{nm}' is loaded",
                             f"\\usepackage{{{nm}}} not found",
                             fix="Add `\\usepackage" + (f"[{','.join(req['options_required'])}]" if req.get("options_required") else "") + f"{{{nm}}}`",
                             source=S.get("packages_required", "")))
            continue
        o, loc = used[nm]
        probs = [f"missing option '{x}'" for x in req.get("options_required", []) if x not in o]
        probs += [f"forbidden option '{x}'" for x in req.get("options_forbidden", []) if x in o]
        F.append(finding(f"tex.pkg.{nm}", not probs, f"Package '{nm}' loaded with the right options",
                         "; ".join(probs), location=loc,
                         fix=f"Use `\\usepackage[{','.join(req.get('options_required', []))}]{{{nm}}}`",
                         source=S.get("packages_required", "")))
    forb = T.get("packages_forbidden")
    if forb is None and T.get("forbid_layout_hacks", False):
        forb = DEFAULT_FORBIDDEN_PACKAGES
    allow = set(T.get("allow_packages", []))
    bad = []
    for pk in forb or []:
        pk, why = (pk["name"], pk.get("reason", "")) if isinstance(pk, dict) else (pk, "")
        if pk in used and pk not in allow:
            bad.append(f"{pk} ({used[pk][1]}){': ' + why if why else ''}")
    if forb is not None:
        F.append(finding("tex.pkg_forbidden", not bad, "No forbidden layout packages", "; ".join(bad),
                         fix="Remove these `\\usepackage` lines. They change margins/spacing and often trigger desk rejection.",
                         source=S.get("packages_forbidden", S.get("forbid_layout_hacks", "")), severity=T.get("layout_hacks_severity", "error")))

    # ---- layout hacks -------------------------------------------------
    if T.get("forbid_layout_hacks", False):
        hits = []
        for rel, ln, clean, _ in src.lines:
            for rx, label, fix in LAYOUT_HACKS:
                if re.search(rx, clean):
                    hits.append((f"{rel}:{ln}", label, fix, clean.strip()[:70]))
        F.append(finding("tex.layout_hacks", not hits, "No spacing/margin hacks in the source",
                         "" if not hits else f"{len(hits)} hit(s): " + "; ".join(f"{l} {lab} `{c}`" for l, lab, _, c in hits[:8]),
                         location=", ".join(h[0] for h in hits[:8]),
                         fix=" / ".join(sorted({h[2] for h in hits})[:3]),
                         source=S.get("forbid_layout_hacks", ""),
                         severity=T.get("layout_hacks_severity", "warn")))

    # ---- bibliography style -----------------------------------------
    bs_allowed = T.get("bibliography_style")
    if bs_allowed:
        m = re.search(r"\\bibliographystyle\s*\{([^}]*)\}", src.clean)
        if not m and not re.search(r"\\bibliography\s*\{", src.clean):
            F.append(Finding("tex.bibstyle", "skip", "Bibliography style is the required one",
                             "No BibTeX (\\bibliography) in the source: thebibliography/biblatex cannot be verified "
                             f"automatically. Required style: {', '.join(bs_allowed)}."))
        else:
            F.append(finding("tex.bibstyle", bool(m) and m.group(1).strip() in bs_allowed,
                             "Bibliography style is the required one",
                             f"found '{m.group(1)}'" if m else "\\bibliography used but no \\bibliographystyle",
                             location=src.where(m.start()) if m else "",
                             fix=f"Use `\\bibliographystyle{{{bs_allowed[0]}}}` and the official .bst file.",
                             source=S.get("bibliography_style", "")))

    # ---- official style files untouched ------------------------------
    off = T.get("official_files") or {}
    if off:
        assets = Path(__file__).resolve().parents[2] / "assets" / "official"
        for fname, meta in off.items():
            found = [f for f in src.root.rglob(fname)]
            if not found:
                F.append(Finding(f"tex.official.{fname}", "skip", f"Official file {fname} untouched",
                                 "not in the project folder (maybe loaded from the TeX tree) - cannot verify"))
                continue
            if not meta.get("sha256"):
                F.append(Finding(f"tex.official.{fname}", "skip", f"Official file {fname} untouched", "no reference hash in rules.json (rebuild the skill with --inventory)"))
                continue
            h = sha256_normalized(found[0])
            same = h == meta["sha256"]
            diff = ""
            ref = assets / fname
            if not same and ref.exists():
                d = list(difflib.unified_diff(ref.read_text(errors="ignore").splitlines(),
                                              found[0].read_text(errors="ignore").splitlines(),
                                              "official", "yours", n=0, lineterm=""))
                diff = " | ".join(d[:10])
            F.append(finding(f"tex.official.{fname}", same, f"Official file {fname} is unmodified",
                             "" if same else "Differs from the kit version. " + diff,
                             location=str(found[0].relative_to(src.root)),
                             fix=f"Replace it with the original {fname} from the author kit and move any customisation "
                                 "into your own .tex file (if the venue allows it).",
                             source=S.get("official_files", "")))

    # ---- anonymity ----------------------------------------------------
    A = rules.get("anonymity") or {}
    if A.get("required"):
        leaks = []
        for nm in names:
            for rel, ln, clean, raw in src.lines:
                if nm and nm.lower() in raw.lower():
                    leaks.append(f"{rel}:{ln} contains '{nm}'" + ("" if nm.lower() in clean.lower() else " (inside a comment)"))
        for rel, ln, clean, raw in src.lines:
            if EMAIL_RE.search(raw):
                leaks.append(f"{rel}:{ln} email address")
            for pat in A.get("forbid_text_patterns", []):
                if re.search(pat, clean, re.I):
                    leaks.append(f"{rel}:{ln} matches /{pat}/")
        for m in re.finditer(r"\\(?:thanks|affiliation|email)\s*\{", src.clean):
            leaks.append(f"{src.where(m.start())} \\{m.group(0)[1:-1].strip()} (check it is hidden in review mode)")
        F.append(finding("tex.anon", not leaks, "No identifying information in the source",
                         "" if not leaks else "; ".join(leaks[:10]),
                         fix="Blank the author block (the template's review mode usually does this), delete emails, "
                             "acknowledgements and self-identifying links; strip comments that name people.",
                         source=sources(A).get("required", ""), severity="error"))
    return F, src


# ---- helpers used by the checklist evaluator ------------------------------------
def section_words(src, title_regex):
    """Return (found, words) for the first section whose title matches. Approximate."""
    head = re.compile(r"\\(?:sub)*section\*?\s*\{([^}]*)\}")
    ms = list(head.finditer(src.clean))
    for i, m in enumerate(ms):
        if re.fullmatch(title_regex, m.group(1).strip(), re.I):
            end = ms[i + 1].start() if i + 1 < len(ms) else len(src.clean)
            body = src.clean[m.end():end]
            body = re.sub(r"\\(cite[a-z]*|ref|label|eqref)\s*(\[[^\]]*\])?\{[^}]*\}", " ", body)
            body = re.sub(r"\\[a-zA-Z]+\*?", " ", body)
            return True, len(re.findall(r"[A-Za-z]{3,}", body)), src.where(m.start())
    return False, 0, ""
