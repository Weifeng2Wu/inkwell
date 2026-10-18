---
name: $name
description: $description
---

# $venue: submission format check

Checks a paper against the $venue author kit (rules extracted on $date) and reports what to fix, where, and how.
The rules live in `rules.json`; the checking code in `scripts/` is generic. Every rule keeps a pointer to the kit passage it came from, so a
wrong rule can be traced and corrected instead of trusted blindly.

## Workflow

1. **Collect inputs.** The normal case is that the user uploads the **whole paper folder** (or a zip of it). Use project mode; it needs nothing else:
   it finds the main .tex, picks the paper PDF (not the figure PDFs), compiles a copy if there is no PDF, warns when the PDF is older than the sources,
   checks every `\includegraphics` (missing files, non-embedded/Type 3 fonts, per figure) and scans the whole folder for identity leaks (`.git`, .bib, aux/fls paths).
   If only a PDF or only a .docx is given, run the narrower checks and say which checks could not run.
   Also establish the **phase**: $phases_line If the user does not say, ask once; the rules differ (anonymity, line numbers, page limit).
   For anonymity checks ask for the author names / institutions to search for (`--names "A,B,Univ X"`); they are used only for this run.
2. **Compilation.** Project mode compiles a copy when no paper PDF is in the folder. If compilation fails, the report shows the log tail; fix the
   first error. Never "fix" a compile error by editing the official style file. A PDF the user compiled themselves is preferable to ours if their
   TeX distribution differs (page breaks can shift slightly), so mention which PDF was checked.
3. **Run the engine** (from this skill's folder):
   ```
   python scripts/run_checks.py --rules rules.json --project PAPER_FOLDER_OR_ZIP \
       --phase $default_phase --names "..." --out report.md --json report.json
   ```
   Add `--main sub/paper.tex` if the folder has several files with `\documentclass` (the report says which one it picked; confirm it with the user
   when it is ambiguous). Uploaded folders are read-only: the checker never edits them and compiles only a copy. Without a project folder use
   `--pdf PAPER.pdf` and/or `--tex SOURCE`.
   Exit code 1 means at least one must-fix finding. `--docx FILE [--docx-to-pdf]` handles Word files.
4. **Handle the manual checklist.** Items marked as manual need your judgement: read the relevant part of the paper (PDF text or source) and decide
   pass / fail / unsure, quoting the evidence (section name, one sentence). Never mark a manual item as passed without having looked.
5. **Report to the user** in the user's language, ordered by risk of desk rejection: must-fix first, then warnings, then manual items.
   For each problem give the location (file:line or page), why it matters (one clause), and the concrete fix. For LaTeX fixes, show the exact
   lines to change. Offer to apply the fixes to a copy of the source, recompile, and re-run the engine until no must-fix remains.
6. **Close honestly.** State which inputs were not provided (so which checks did not run) and remind the user that the official CFP/kit
   is the authority; the submission system may apply additional automatic checks.

## What the rules cover

$rule_summary

Details and the original wording of each rule: `references/kit_notes.md` (if present) and the `_sources` fields in `rules.json`.

## Known blind spots (say so when relevant)

- Text-extraction based checks (headings, anonymity, checklist keywords) can miss text inside figures and can misread unusual layouts.
- Page-limit logic assumes the main body ends at the first heading listed in `pdf.page_limit.main_body_ends_at`; check by eye if the paper uses unusual section names.
- Margin checks inspect words and embedded images, not vector drawings; a wide TikZ/vector figure can still overflow.
- Word files: Word does not store page breaks, so page count needs a PDF export.
- Style-file integrity is only verifiable when the style files are inside the project folder.
- Compliance with this checker is not a guarantee against desk rejection.

## Updating this skill

Venues revise their kits yearly. When a new author kit is released, regenerate this skill from it (or edit `rules.json` and replace `assets/official/`)
rather than patching individual rules from memory.
