"""PDF checks (pdfplumber + poppler's pdffonts)."""
import re
import shutil
import subprocess
from collections import Counter, defaultdict

import pdfplumber

from .common import finding, margins_pt, sources, Finding

PAGE_SIZES = {"A4": (595.28, 841.89), "LETTER": (612.0, 792.0)}
# pdfplumber merges glyphs closer than x_tolerance; its default (3pt) swallows the narrow word spaces of Times
# ("Wei Feng" -> "WeiFeng"), which silently breaks every text match. 1.2pt keeps words apart and kerning intact.
XTOL = 1.2
# Math / symbol fonts are expected even when the text font is restricted.
MATH_FONT_RE = re.compile(
    r"^(CMMI|CMSY|CMEX|CMBSY|CMMIB|MSAM|MSBM|LMMath|STIX|TXMI|TXSY|TXEX|MTMI|MTSY|MTEX|MTExtra|"
    r"rsfs|EUFM|EUSM|EURM|EURB|Symbol|ZapfDingbats|Wasy|lasy)", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
HOST_RE = re.compile(r"(?:github\.com|gitlab\.com|bitbucket\.org|huggingface\.co|sites\.google\.com|"
                     r"\w+\.github\.io)/?[\w./-]*", re.I)


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _strip_subset(name):
    return re.sub(r"^[A-Z]{6}\+", "", name or "")


def split_lines(words, gap=14.0, ytol=2.5):
    """Group words into visual lines, splitting at column gaps."""
    rows = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        for r in rows:
            if abs(r[0]["top"] - w["top"]) <= ytol:
                r.append(w)
                break
        else:
            rows.append([w])
    out = []
    for r in rows:
        r.sort(key=lambda w: w["x0"])
        seg = [r[0]]
        for w in r[1:]:
            if w["x0"] - seg[-1]["x1"] > gap:
                out.append(seg)
                seg = [w]
            else:
                seg.append(w)
        out.append(seg)
    return [{"text": " ".join(w["text"] for w in s), "x0": s[0]["x0"], "x1": s[-1]["x1"],
             "top": min(w["top"] for w in s), "bottom": max(w["bottom"] for w in s)} for s in out]


def _heading_matches(text, patterns):
    cands = {text.strip(), re.sub(r"^(?:[A-Z]|\d+(?:\.\d+)*)\.?\s+", "", text.strip())}
    return any(re.fullmatch(p, c, re.I) for p in patterns for c in cands)


def _pdffonts(path):
    exe = shutil.which("pdffonts")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, path], capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return None
    rows = []
    for line in out.splitlines()[2:]:
        m = re.match(r"^(\S+)\s+(.+?)\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$", line)
        if m:
            rows.append({"name": _strip_subset(m.group(1)), "type": m.group(2), "emb": m.group(3) == "yes"})
    return rows


def run(pdf_path, rules, names=None):
    P = rules.get("pdf", {}) or {}
    S = sources(P)
    names = names or []
    F = []
    ctx = {}
    with pdfplumber.open(pdf_path) as pdf:
        pages = pdf.pages
        n = len(pages)
        words_by_page = [p.extract_words(use_text_flow=False, keep_blank_chars=False, x_tolerance=XTOL, extra_attrs=["size"]) for p in pages]
        text_pages = [p.extract_text(x_tolerance=XTOL) or "" for p in pages]
        ctx["text"] = "\n".join(text_pages)
        ctx["pages_text"] = text_pages
        meta = pdf.metadata or {}

        # ---- page size -------------------------------------------------
        if P.get("page_size"):
            want = PAGE_SIZES[P["page_size"].upper()]
            bad = [i + 1 for i, p in enumerate(pages)
                   if abs(p.width - want[0]) > 3 or abs(p.height - want[1]) > 3]
            F.append(finding("pdf.page_size", not bad, f"Page size is {P['page_size']}",
                             "" if not bad else f"Pages with wrong size: {bad[:10]} (first page is "
                             f"{pages[0].width:.0f}x{pages[0].height:.0f} pt)",
                             fix="Set the paper size from the official style file (e.g. `\\usepackage[a4paper]{...}` "
                                 "or the template's own option). Do not hand-set `\\paperwidth`; also check "
                                 "`dvips/dvipdf` or `\\pdfpagewidth` settings if you compile via DVI.",
                             source=S.get("page_size", "")))

        # ---- page limits -----------------------------------------------
        PL = P.get("page_limit") or {}
        if PL.get("total") is not None:
            F.append(finding("pdf.total_pages", n <= PL["total"], f"Total pages <= {PL['total']}",
                             f"PDF has {n} pages", fix="Cut content or move material to an allowed appendix.",
                             source=S.get("page_limit", "")))
        if PL.get("main_body") is not None:
            limit = PL["main_body"]
            markers = PL.get("main_body_ends_at") or []
            hit = None
            for i, (p, words) in enumerate(zip(pages, words_by_page)):
                for ln in split_lines(words):
                    if _heading_matches(ln["text"], markers):
                        hit = (i, ln, p)
                        break
                if hit:
                    break
            if not markers or not hit:
                F.append(finding("pdf.page_limit", n <= limit,
                                 f"Main body <= {limit} pages",
                                 f"Could not locate a heading that ends the main body (looked for {markers}). "
                                 f"PDF has {n} pages in total, so the main body is at most {n}. "
                                 "Verify the page where References/Limitations start by hand.",
                                 severity="warn" if n > limit else "error",
                                 fix="Cut content so the main text fits; sections the kit excludes from the limit "
                                     "(references, limitations, ethics...) may spill over.",
                                 source=S.get("page_limit", "")))
            else:
                i, ln, p = hit
                pno = i + 1
                note = ""
                ok = pno <= limit
                if not ok and pno == limit + 1:
                    above = [w for w in words_by_page[i]
                             if w["top"] < ln["top"] - 3 and w["top"] > 0.07 * p.height
                             and not re.fullmatch(r"[\d.,:]+", w["text"])]
                    if not above:
                        ok = True
                        note = " (the excluded section starts at the very top of the next page, so the body ends on the limit page)"
                F.append(finding("pdf.page_limit", ok, f"Main body <= {limit} pages",
                                 f"Main body ends where heading '{ln['text']}' starts: page {pno}, "
                                 f"{100 * ln['top'] / p.height:.0f}% down the page{note}.",
                                 location=f"page {pno}",
                                 fix=f"Cut {'roughly a page or more' if pno > limit + 1 else 'part of a page'} of body text "
                                     "before that heading: shrink figures, trim related work, move detail to the appendix "
                                     "if the venue allows. Do not use negative \\vspace.",
                                 source=S.get("page_limit", "")))

        # ---- margins ---------------------------------------------------
        M = margins_pt(P.get("margins"))
        if M and len(M) == 4:
            tol = float((P.get("margins") or {}).get("tolerance_pt", 3))
            skip_top = float((P.get("margins") or {}).get("skip_top_pt", 0))
            skip_bot = float((P.get("margins") or {}).get("skip_bottom_pt", 0))
            viol = defaultdict(dict)   # page -> side -> (overflow, sample)
            for i, (p, words) in enumerate(zip(pages, words_by_page), 1):
                W, H = p.width, p.height
                L, R, T, B = M["left"], W - M["right"], M["top"], H - M["bottom"]
                items = []
                for w in words:
                    if w["bottom"] < skip_top or w["top"] > H - skip_bot:
                        continue
                    outside = w["x1"] < L or w["x0"] > R or w["bottom"] < T or w["top"] > B
                    if outside and re.fullmatch(r"[\d.,:]+", w["text"]):
                        continue  # line / page numbers living in the margin
                    items.append((w["x0"], w["x1"], w["top"], w["bottom"], w["text"][:30], w.get("size", 10)))
                for im in p.images:
                    items.append((im["x0"], im["x1"], im["top"], im["bottom"], "<image>", 0))
                for x0, x1, top, bot, txt, sz in items:
                    # glyph boxes extend beyond the TeX text block by a fraction of the font size
                    vt = tol + 0.35 * sz
                    for side, over, t_ in (("left", L - x0, tol), ("right", x1 - R, tol),
                                           ("top", T - top, vt), ("bottom", bot - B, vt)):
                        if over > t_ and over > viol[i].get(side, (0, ""))[0]:
                            viol[i][side] = (over, txt)
            detail = "; ".join(f"p{pg}: " + ", ".join(f"{side} +{o:.0f}pt ('{s}')" for side, (o, s) in d.items())
                               for pg, d in list(viol.items())[:6])
            F.append(finding("pdf.margins", not viol, "Content stays inside the required margins",
                             "" if not viol else f"{len(viol)} page(s) overflow: {detail}",
                             location="" if not viol else f"pages {list(viol)[:12]}",
                             fix="Overflow is usually one of: a wide table/figure (`\\resizebox{\\columnwidth}{!}{...}` or "
                                 "`tabularx`/`\\small`), a long unbreakable URL or identifier (`\\usepackage{xurl}`, "
                                 "`\\sloppy`, or rephrase), or an overlong equation (`multline`/`split`). "
                                 "Do not edit margins or the style file.",
                             source=S.get("margins", "")))

        # ---- fonts -----------------------------------------------------
        FO = P.get("fonts") or {}
        fam, sizes = Counter(), Counter()
        small = defaultdict(Counter)   # page -> size -> chars
        for i, p in enumerate(pages, 1):
            for ch in p.chars:
                name = _strip_subset(ch.get("fontname", ""))
                if MATH_FONT_RE.match(name) or not ch["text"].strip():
                    continue
                fam[name] += 1
                sizes[round(ch["size"], 1)] += 1
                floor = FO.get("min_size_pt")
                if floor and ch["size"] < floor - 0.25:
                    small[i][round(ch["size"], 1)] += 1
        allowed = [_norm(a) for a in FO.get("allowed_families", [])]
        if allowed:
            bad = {f: c for f, c in fam.items() if c >= FO.get("min_chars_to_flag", 20)
                   and not any(a in _norm(f) for a in allowed)}
            if "unknown" in bad:
                bad["unknown (Type 3 / bitmap font, name unreadable)"] = bad.pop("unknown")
            F.append(finding("pdf.fonts_allowed", not bad, "Only the required font family is used",
                             "" if not bad else "Unexpected fonts (chars): " + ", ".join(f"{f} ({c})" for f, c in
                                                                                         sorted(bad.items(), key=lambda x: -x[1])[:8]),
                             fix="Unreadable names or CM*/Latin Modern text fonts usually mean the required font was not found (TeX then builds bitmap Type 3 fonts), the style file was not loaded, or it was overridden "
                                 "(e.g. a later `\\usepackage{lmodern}`/`\\renewcommand{\\rmdefault}`). Fonts from figures: "
                                 "re-export with the required font; in matplotlib set `rcParams['pdf.fonttype']=42` and "
                                 "`rcParams['font.family']='serif'`.",
                             source=S.get("fonts", "")))
        if FO.get("body_size_pt"):
            dom = sizes.most_common(1)[0][0] if sizes else None
            ok = dom is not None and abs(dom - FO["body_size_pt"]) <= 0.35
            F.append(finding("pdf.font_size_body", ok, f"Body text is {FO['body_size_pt']} pt",
                             f"Most common text size is {dom} pt" if dom else "No text found",
                             fix="Use the size option from the official template (e.g. `[11pt]` in `\\documentclass`); "
                                 "never rescale with `\\fontsize` or `\\small` for the whole document.",
                             source=S.get("fonts", "")))
        if FO.get("min_size_pt"):
            tot = sum(sum(c.values()) for c in small.values())
            thr = FO.get("min_chars_to_flag", 20) * 2
            F.append(finding("pdf.font_size_min", tot < thr, f"No text smaller than {FO['min_size_pt']} pt",
                             "" if tot < thr else f"{tot} characters below the floor, e.g. " +
                             "; ".join(f"p{pg}: " + ", ".join(f"{s}pt x{c}" for s, c in cnt.most_common(2))
                                       for pg, cnt in list(small.items())[:5]),
                             location="" if tot < thr else f"pages {list(small)[:12]}",
                             fix="Usually tiny table text (`\\tiny`, `\\scriptsize`) or text inside figures: "
                                 "enlarge figure fonts to match caption size, split wide tables, or use `\\footnotesize` "
                                 "at the smallest if the kit allows it.",
                             source=S.get("fonts", "")))
        pf = _pdffonts(pdf_path)
        if pf is not None:
            if FO.get("require_embedded", False):
                noemb = sorted({r["name"] for r in pf if not r["emb"]})
                F.append(finding("pdf.fonts_embedded", not noemb, "All fonts are embedded",
                                 "" if not noemb else "Not embedded: " + ", ".join(noemb[:8]),
                                 fix="Figures are the usual culprit. Re-export with embedded fonts (matplotlib: "
                                     "`pdf.fonttype=42`; Illustrator/Inkscape: 'convert text to outlines' or embed all). "
                                     "Then compile with `pdflatex` (not dvips) and check `pdffonts paper.pdf`.",
                                 source=S.get("fonts", "")))
            if FO.get("forbid_type3"):
                t3 = sorted({r["name"] for r in pf if r["type"].lower().startswith("type 3")})
                F.append(finding("pdf.type3", not t3, "No Type 3 fonts",
                                 "" if not t3 else "Type 3 fonts: " + ", ".join(t3[:8]),
                                 fix="Matplotlib: `matplotlib.rcParams['pdf.fonttype']=42` (and `ps.fonttype`). "
                                     "Other tools: export TrueType/Type 1 instead of Type 3. Fix the figure, regenerate, recompile.",
                                 source=S.get("fonts", "")))
        else:
            F.append(Finding("pdf.fonts_embedded", "skip", "Font embedding check skipped",
                             "`pdffonts` (poppler-utils) not found."))

        # ---- line numbers ------------------------------------------------
        ln_rule = P.get("line_numbers")  # "required" | "forbidden" | None
        if ln_rule and M:
            cnt = 0
            for p, words in list(zip(pages, words_by_page))[:2]:
                cnt += sum(1 for w in words if re.fullmatch(r"\d{1,4}", w["text"]) and w["x1"] < M["left"] + 2)
            has = cnt >= 15
            if ln_rule == "required":
                F.append(finding("pdf.line_numbers", has, "Line numbers are present (review version)",
                                 f"Found {cnt} margin numbers on the first two pages",
                                 fix="Enable the review option of the official style (e.g. `\\usepackage[review]{...}`).",
                                 source=S.get("line_numbers", "")))
            else:
                F.append(finding("pdf.line_numbers", not has, "No line numbers (final version)",
                                 f"Found {cnt} margin numbers on the first two pages",
                                 fix="Switch the style option to the final/camera-ready mode.",
                                 source=S.get("line_numbers", "")))

        # ---- anonymity ---------------------------------------------------
        A = rules.get("anonymity") or {}
        if A.get("required"):
            author = (meta.get("Author") or "").strip()
            bad_meta = bool(author) and author.lower() not in ("anonymous", "anonymous authors")
            hits = [n_ for n_ in names if n_ and (n_.lower() in author.lower() or n_.lower() in (meta.get("Title") or "").lower())]
            F.append(finding("pdf.anon_metadata", not (bad_meta or hits), "PDF metadata does not reveal authors",
                             "" if not (bad_meta or hits) else f"PDF Author field is '{author}'",
                             fix="Set `\\hypersetup{pdfauthor={}}` or remove the `pdfauthor` entry from `\\usepackage[...]{hyperref}`; "
                                 "check Title too. Verify with `pdfinfo paper.pdf`.",
                             source=sources(A).get("required", "")))
            pats = [re.compile(p, re.I) for p in A.get("forbid_text_patterns", [])]
            pats += [EMAIL_RE, HOST_RE] + [re.compile(re.escape(x), re.I) for x in names if x]
            leaks = []
            for pi, t in enumerate(text_pages, 1):
                for rx in pats:
                    for m in rx.finditer(t):
                        leaks.append(f"p{pi}: '{m.group(0)[:50]}'")
                squashed = re.sub(r"\s+", "", t).lower()
                for x in names:
                    if x and re.sub(r"\s+", "", x).lower() in squashed and not any(
                            x.lower() in l.lower() for l in leaks if l.startswith(f"p{pi}:")):
                        leaks.append(f"p{pi}: '{x}' (found ignoring spaces)")
            for pi, t in enumerate(text_pages, 1):
                for h in A.get("forbid_headings", [r"Acknowledg(e)?ments?"]):
                    if re.search(rf"^\s*(?:\d+\s+)?{h}\s*$", t, re.I | re.M):
                        leaks.append(f"p{pi}: heading '{h}'")
            F.append(finding("pdf.anon_text", not leaks, "No identifying text in the PDF body",
                             "" if not leaks else "; ".join(leaks[:10]),
                             fix="Remove emails, repository links and acknowledgements for the review version (or replace "
                                 "with anonymous links, e.g. anonymous.4open.science). Cite your own prior work in third person.",
                             source=sources(A).get("required", "")))
    return F, ctx
