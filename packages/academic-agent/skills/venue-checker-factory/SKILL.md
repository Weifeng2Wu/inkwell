---
name: venue-checker-factory
description: Turn a conference or journal author kit (formatting instructions PDF, LaTeX/Word template, style files, CFP, checklist) into a dedicated, reusable pre-submission format-check skill for that venue, e.g. "acl-2027-format-check", which checks a paper's PDF/LaTeX/Word against the venue's page limit, margins, fonts, anonymity, style-file integrity and required checklist items and gives concrete fixes. Use whenever the user uploads an author kit, formatting guidelines or template for a venue and wants to check, prepare or "make a skill for" paper formatting, or says things like "generate a format-check skill for this conference", "每次投稿前检查格式", "根据 author kit 生成检查 skill", even if they do not say "skill".
---

# Venue checker factory

Builds a per-venue format-check skill from an author kit. The factory contains a generic, tested checking engine; what it produces for each
venue is mostly **data** (`rules.json` extracted from the kit, with a source pointer for every rule) plus the kit's official style files
(so the engine can detect a modified style file by hash). Keeping rules as data is what makes the result checkable and cheap to update when the venue
revises its kit.

Do not hand-write a venue's checking code. If the engine lacks a check the kit needs, either express it as a `checklist` item (regex or manual) or
extend `scripts/checks/` and re-run the self-test, so every generated skill benefits.

## Workflow

### 1. Pin down the target
Ask only what you cannot read from the kit: venue + year, **track** (long/short/demo/journal article type), and which **phase** the user will mostly
check (review / camera-ready; model both when the kit covers both). Ask for the full kit: formatting-instructions PDF, template folder or zip
(.tex/.sty/.cls/.bst), CFP page, and any checklist. If the user only names the venue and fetching is possible, look for the official kit
and say which pages you used. The official source, not memory, is what the rules come from.

### 2. Extract the kit
```
python scripts/extract_kit.py <uploaded files or dirs> --out /home/claude/work/kit_text
```
Then read, in this order: `inventory.json` (what is in the kit, hashes), the formatting-instructions text, `style_digest.md` (the .sty/.cls is the
ground truth for geometry, fonts and review/final options), then the CFP and any checklist. Read the text itself; do not skim a summary. Kits bury hard rules
in footnotes ("papers that violate the margin will be rejected", "Type 3 fonts are not allowed").

### 3. Interview the user about what the kit leaves open, then write `rules.json`
Same habit as skill-creator's interview step: do not guess where the kit is vague. While reading, keep a list of open points and ask the user
(one batch, at most three questions, with concrete options, e.g. via `ask_user_input_v0` when available) before finalizing. Typical ones: which
track / paper type; whether review and camera-ready should both be modelled; which "should" items to treat as errors; whether sections the kit
does not mention (appendix, ethics) count toward the limit; how strict to be on spacing tweaks. Record each answer in `_sources` as
"user decision", so it is distinguishable from what the kit says.

Follow `references/rules-schema.md` (read it now; it has the full schema, a kit-wording-to-rule table, and traps). Principles:
- Only encode what the kit states. Silence means no rule. Do not backfill from what other venues usually require.
- Every rule gets a `_sources` entry or a checklist `source` with file/page and a few words of the original, because the user will verify them.
- Mark severity from the kit's language: "must / will be rejected" is `error`; "should / encouraged" is `warn`.
- Model phases (review vs final) as overrides, and put tracks in separate skills or ask.
- Requirements that cannot be machine-checked (novelty statements, ethics content, checklist answers) become manual checklist items with a precise description of
  what to verify, never silently dropped.
- Compute derived values (text block -> margins) yourself and say so in `_sources`.

### 4. Build the venue skill
```
python scripts/build_venue_skill.py --name <venue>-<year>-format-check --rules rules.json \
    --inventory kit_text/inventory.json --kit-notes kit_notes.md --out /home/claude/skills
```
`kit_notes.md` is a short human-readable digest you write: the rules table (rule, value, source), judgement calls you made, conflicts between kit documents,
and what is **not** covered. The builder lints the rules (missing sources, incomplete margins, empty heading list), copies the engine, hashes and copies the official
style files, and writes the venue `SKILL.md`. Fix every WARNING it prints.

### 5. Calibrate before trusting it (do not skip)
A checker with false alarms gets ignored; one with false passes is worse. Test it on the kit itself:
1. **Positive control.** Compile the kit's own sample paper (needs the kit's style files; `pdflatex` + `bibtex`). In the review phase the engine should report
   **zero must-fix**. Every must-fix on the official sample is a wrong rule or a wrong engine assumption: fix the rule (or the engine) and re-run.
2. **Negative controls.** Make 3-5 mutated copies, each breaking one thing: add `\vspace{-1cm}`, switch the font/size, put an author name in the review version,
   delete the Limitations section, overflow a table, edit one line of the .sty. Each must be caught with a fix that points at the right place.
3. If the kit has no sample, build a small synthetic paper with the kit's style and do the same, and tell the user the positive control is weaker.
Report what you tested and what failed along the way. If something could not be tested (e.g. no style files in the kit), say so plainly.

### 6. Show the user the rules, then deliver
Present a compact table of the extracted rules with sources and mark the ones you are least sure of (derived values, ambiguous wording, conflicts), and ask
them to confirm or correct before relying on it. Then package:
```
cd /mnt/skills/examples/skill-creator && python -m scripts.package_skill /home/claude/skills/<name> /mnt/user-data/outputs
```
and share the `.skill` file with `present_files`. Tell the user how to use it next time (upload paper + say the venue/phase), and that for a new venue they
upload that venue's kit and invoke this factory again.

## Notes on the engine (what generated skills can do)
- **Project mode** (`--project folder-or-zip`): the user is expected to upload the whole paper folder. It finds the main .tex, picks the paper PDF among
  figure PDFs, compiles a copy when no PDF exists, flags a stale PDF, checks each included figure (exists, fonts), and scans the folder for identity leaks.
  Positive/negative controls in step 5 should therefore be run in project mode on a folder, not only on a loose PDF.
- PDF: page size, main-body page limit (heading-based), margins (words + images), allowed fonts, body/min font size, embedded and Type 3 fonts, line numbers,
  metadata and text anonymity (emails, code-hosting links, names the user supplies, Acknowledgements).
- LaTeX: documentclass/package options, forbidden packages, layout hacks (negative vspace, geometry, linespread, length overrides), bibliography style,
  **modified official style files** (hash + diff), anonymity leaks including comments, checklist sections by regex or section word count.
- Word: page size, margins, fonts, body size, line spacing; page count via PDF export.
- Output: markdown report + JSON, each finding with location, concrete fix and the kit source of the rule.
- Not covered: anything inside vector figures, semantic requirements (is the ethics statement adequate), submission-system-specific checks. State this to the user.
