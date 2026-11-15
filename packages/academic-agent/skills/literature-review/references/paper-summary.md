# Single-paper summary template

Use this structure for `papers/<pdf base name>.summary.md` (or the location the user chose). Write it in the user's language. Keep it to roughly one screen unless the user asks for depth; a short accurate summary beats a long padded one.

Evidence labels: `[notes p.N]`, `[text p.N]` or `[text]`, `[bib]`, `[user]`, `[unverified]`. Every factual bullet carries one. A bullet may carry two when both support it.

## Template

```markdown
# <Paper title>

- **Key:** `<citekey>`
- **Reference:** <authors>, <venue>, <year> [bib]
- **Sources used for this summary:** <e.g. "12 highlights in the notes file (pp. 1–9); BibTeX abstract. Full text not provided.">
- **Coverage:** <which parts of the paper the sources cover, and which they do not>

## Research question

<One to three sentences: what problem the paper addresses and why the authors say it matters.> [label]

## Method

- <Approach, model, or study design> [label]
- <Data, participants, materials, or benchmarks> [label]
- <Evaluation protocol, baselines, metrics> [label]

## Main results

- <Result with the exact value, unit, dataset or condition, and the baseline it is compared against> [label]
- <…>

## Limitations

- **Stated by the authors:** <…> [label]
- **Noted by the user:** <…> [user]
- **My assessment:** <only what follows from the material above; say what it is based on>

## Relation to the user's project

- <How it supports, contradicts, or motivates the user's work; which manuscript section it is relevant to>
- <What could be cited from it, and for which claim>

## Key quotes

> "<verbatim quote>" (p. N)

## Open questions and what to check

- <Sections not covered by the available material>
- <Claims that need the full text to confirm>
```

## Filling it in

- **Sources line first.** Write it before anything else and let it bound the rest. If the only source is the BibTeX abstract, the summary is an abstract paraphrase and must say so.
- **Research question.** Prefer the authors' own framing from a quote or the abstract. Do not upgrade "we explore" into "we show".
- **Method.** Describe only what the sources state. If the notes skip the method, write "Not covered by the available material" and add it to the open questions.
- **Results.** Copy numbers exactly: no rounding, no unit conversion, no merging of conditions. Keep the comparison ("vs. X on Y") attached to the number. If a highlight contains a number without context, report it with that caveat.
- **Limitations.** Keep three voices apart: the authors', the user's (from comments), and yours. Yours must be reasoned from the material shown, not from general impressions of the field.
- **Relation to the user's project.** Ground this in the manuscript in the workspace (introduction, contributions) or in what the user told you. If you know neither, ask, or leave a one-line prompt for the user instead of speculating.
- **Key quotes.** Three to six at most, verbatim from the sidecar or supplied text, each with its page. The sidecar escapes some Markdown characters with backslashes; remove only that escaping, change nothing else.
- **Pages.** Use the page recorded in the annotation. For supplied text, give a page only when the text has page markers. Never estimate a page.

## Before saving

- [ ] Every factual bullet has an evidence label; no bullet rests on memory of the paper.
- [ ] Every number matches its source character for character.
- [ ] Every quotation is verbatim and has a page.
- [ ] The user's comments are attributed to the user, not to the paper.
- [ ] Empty sections say so explicitly instead of being filled with generic text.
- [ ] The notes sidecar and `papers/reading-digest.md` are unchanged.
- [ ] An existing summary file was updated rather than blindly replaced, and the user's own additions to it are preserved.
