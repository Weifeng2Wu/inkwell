#!/usr/bin/env python3
"""Venue format checker.

  python scripts/run_checks.py --rules rules.json --pdf paper.pdf --tex paper_dir_or.zip \
      [--docx paper.docx [--docx-to-pdf]] [--phase review|final] [--names "Wei Feng,Jai Lee"] \
      [--out report.md] [--json report.json]

The rules file is data; this engine is generic. Findings carry the kit source of the rule and a concrete fix.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

# Reports include Unicode symbols and manuscript text even on Windows pipes.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from checks.common import Finding, deep_merge  # noqa: E402


def evaluate_checklist(items, pdf_ctx, tex_src):
    from checks import check_tex
    out = []
    for it in items:
        dets = it.get("detect") or []
        if isinstance(dets, dict):
            dets = [dets]
        sev = it.get("severity", "error")
        res = None
        for d in dets:
            t = d.get("type")
            if t == "tex_regex" and tex_src is not None:
                found = any(re.search(p, tex_src.clean, re.I | re.M) for p in d["patterns"])
                res = (found == (d.get("expect", "present") == "present"),
                       "found in LaTeX source" if found else "not found in LaTeX source", "")
            elif t == "tex_section" and tex_src is not None:
                ok, words, loc = check_tex.section_words(tex_src, d["title_regex"])
                need = d.get("min_words", 1)
                res = (ok and words >= need,
                       (f"section found ({loc}), about {words} words" if ok else "section not found") +
                       (f"; expected at least {need}" if ok and words < need else ""), loc)
            elif t == "pdf_regex" and pdf_ctx is not None:
                found = any(re.search(p, pdf_ctx["text"], re.I | re.M) for p in d["patterns"])
                res = (found == (d.get("expect", "present") == "present"),
                       "found in PDF text" if found else "not found in PDF text", "")
            if res is not None:
                break
        title = it.get("title", it["id"])
        fix = it.get("fix", "")
        if res is None:
            out.append(Finding(f"checklist.{it['id']}", "manual", title,
                               it.get("description", "") + " (cannot be detected automatically with the given inputs)",
                               fix=fix, source=it.get("source", "")))
        else:
            ok, detail, loc = res
            if ok and it.get("needs_judgement"):
                out.append(Finding(f"checklist.{it['id']}", "manual", title,
                                   "Auto-detected: " + detail + ". Content still needs a human/LLM judgement: "
                                   + it.get("description", ""), location=loc, fix=fix, source=it.get("source", "")))
            else:
                st = "pass" if ok else ("fail" if sev == "error" else "warn")
                out.append(Finding(f"checklist.{it['id']}", st, title, detail, location=loc, fix=fix,
                                   source=it.get("source", "")))
    return out


def render(venue, phase, findings, inputs):
    c = Counter(f.status for f in findings)
    L = [f"# Format check: {venue}" + (f" ({phase})" if phase else ""), "",
         "Inputs: " + ", ".join(f"{k}={v}" for k, v in inputs.items() if v), "",
         f"**{c['fail']} must fix**, {c['warn']} warnings, {c['manual']} manual checks, "
         f"{c['pass']} passed, {c['skip']} not checked.", ""]

    def block(title, status, icon):
        items = [f for f in findings if f.status == status]
        if not items:
            return
        L.append(f"## {icon} {title}")
        for f in items:
            L.append(f"### {f.title}  `{f.id}`")
            if f.detail:
                L.append(f"- Problem: {f.detail}")
            if f.location:
                L.append(f"- Where: {f.location}")
            if f.fix:
                L.append(f"- Fix: {f.fix}")
            if f.source:
                L.append(f"- Rule source: {f.source}")
            L.append("")

    block("Must fix", "fail", "❌")
    block("Warnings", "warn", "⚠️")
    block("Manual checks", "manual", "✋")
    passed = [f for f in findings if f.status == "pass"]
    if passed:
        L.append("## ✅ Passed")
        L += [f"- {f.title}" + (f" ({f.detail})" if f.detail else "") for f in passed] + [""]
    skipped = [f for f in findings if f.status == "skip"]
    if skipped:
        L.append("## ⏭️ Not checked")
        L += [f"- {f.title}: {f.detail}" for f in skipped] + [""]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rules", default=str(Path(__file__).resolve().parents[1] / "rules.json"))
    ap.add_argument("--pdf")
    ap.add_argument("--tex")
    ap.add_argument("--docx")
    ap.add_argument("--project", help="whole paper folder: finds main .tex and the paper PDF (or compiles a copy), checks figures and the folder")
    ap.add_argument("--main", help="main .tex relative to --project/--tex when several files have \\documentclass")
    ap.add_argument("--no-compile", action="store_true", help="do not compile when the folder has no paper PDF")
    ap.add_argument("--docx-to-pdf", action="store_true")
    ap.add_argument("--phase")
    ap.add_argument("--names", default="", help="comma-separated author/institution names to search for (anonymity)")
    ap.add_argument("--out")
    ap.add_argument("--json")
    a = ap.parse_args()

    rules = json.load(open(a.rules, encoding="utf-8"))
    phase = a.phase or rules.get("default_phase")
    if phase and (rules.get("phases") or {}).get(phase):
        rules = deep_merge(rules, rules["phases"][phase])
    names = [n.strip() for n in a.names.split(",") if n.strip()]

    if a.project and a.project.lower().endswith(".zip"):
        import zipfile
        d = tempfile.mkdtemp(prefix="project_")
        zipfile.ZipFile(a.project).extractall(d)
        top = [p for p in Path(d).iterdir() if p.name != "__MACOSX"]
        a.project = str(top[0]) if len(top) == 1 and top[0].is_dir() else d
    if a.project:
        a.tex = a.tex or a.project
    if not (a.pdf or a.tex or a.docx):
        ap.error("give at least one of --project / --pdf / --tex / --docx")

    F, pdf_ctx, tex_src = [], None, None
    if a.docx:
        from checks import check_docx
        f, dctx = check_docx.run(a.docx, rules, names)
        F += f
        if a.docx_to_pdf and not a.pdf:
            exe = shutil.which("soffice") or shutil.which("libreoffice")
            if exe:
                tmp = tempfile.mkdtemp()
                subprocess.run([exe, "--headless", "--convert-to", "pdf", "--outdir", tmp, a.docx],
                               capture_output=True, timeout=180)
                pdfs = list(Path(tmp).glob("*.pdf"))
                if pdfs:
                    a.pdf = str(pdfs[0])
            else:
                F.append(Finding("docx.to_pdf", "skip", "DOCX -> PDF conversion", "LibreOffice not available"))
    if a.tex:
        from checks import check_tex
        f, tex_src = check_tex.run(a.tex, rules, names, a.main)
        F += f
    compiled = False
    if a.project and tex_src is not None:
        from checks import check_project
        root = Path(a.project)
        how = "given on the command line" if a.pdf else "none"
        if not a.pdf:
            pdf, others = check_project.find_paper_pdf(root, tex_src)
            if pdf:
                a.pdf, how = str(pdf), "found in the folder" + (f" (ignored other PDFs: {', '.join(o.name for o in others[:4])})" if others else "")
            elif not a.no_compile:
                pdf, log = check_project.compile_project(root, tex_src.main)
                if pdf:
                    a.pdf, compiled, how = str(pdf), True, "compiled from a copy of the project"
                else:
                    F.append(Finding("proj.compile", "fail", "The project compiles",
                                     "Compilation failed. Log tail: " + " ".join(log.split())[-600:],
                                     fix="Fix the first error in the log (usually a missing package, a missing figure or a style file not in the folder). "
                                         "A paper that does not compile cannot be submitted."))
            else:
                how = "none (compilation disabled)"
        F.append(Finding("proj.inputs", "skip", "Project inputs",
                         f"main source: {tex_src.main.name}; paper PDF: {Path(a.pdf).name if a.pdf else 'none'} ({how})"))
    if a.pdf:
        from checks import check_pdf
        f, pdf_ctx = check_pdf.run(a.pdf, rules, names)
        F += f
    if a.project and tex_src is not None:
        from checks import check_project
        F += check_project.run(a.project, tex_src, a.pdf, rules, names, compiled)
    F += evaluate_checklist(rules.get("checklist", []), pdf_ctx, tex_src)

    if not a.pdf:
        F.append(Finding("pdf.missing", "skip", "Compiled-PDF checks (page count, margins, fonts)",
                         "No PDF provided. Compile the paper and pass --pdf: these are the checks that decide desk rejection."))
    if not a.tex and not a.docx:
        F.append(Finding("src.missing", "skip", "Source checks (packages, style file integrity, layout hacks)",
                         "No LaTeX source provided; only the PDF was inspected."))

    rep = render(rules.get("venue", "venue"), phase, F, {"pdf": a.pdf, "tex": a.tex, "docx": a.docx})
    if a.out:
        Path(a.out).write_text(rep, encoding="utf-8")
    if a.json:
        Path(a.json).write_text(json.dumps([f.to_dict() for f in F], ensure_ascii=False, indent=2), encoding="utf-8")
    print(rep)
    sys.exit(1 if any(f.status == "fail" for f in F) else 0)


if __name__ == "__main__":
    main()
