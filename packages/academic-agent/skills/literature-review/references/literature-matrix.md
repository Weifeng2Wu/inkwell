# Literature matrix template

A literature matrix puts several papers on the same axes so that patterns and gaps become visible. Build it as one Markdown table, save it where the user asks (default `notes/literature-matrix.md`, or `notes/<topic>-matrix.md` when several exist), and follow it with a short synthesis.

## Choosing columns

Pick four to seven columns driven by the user's question. More than that becomes unreadable in a Markdown table; split into two tables instead.

Default set for empirical work:

| Column | What goes in it |
| --- | --- |
| Key | The citation key in backticks, exactly as in the `.bib` |
| Year | From the entry |
| Question / claim | The paper's main question or thesis, in one phrase |
| Method | Approach or study design |
| Data / setting | Dataset, population, benchmark, or domain |
| Main result | The headline finding with value, unit, and comparison |
| Limitations | Stated or evident limits |
| Relevance | How it bears on the user's work |

Alternatives, by kind of review:

- **Methods comparison:** assumptions, inputs required, computational cost, baselines beaten, code or data availability.
- **Theory or position papers:** core argument, concepts introduced, what it argues against, evidence type.
- **Systematic-style review:** study design, sample size, outcome measures, effect direction, risk-of-bias notes.
- **Benchmark tracking:** one column per dataset and metric. Fill a cell only when the metric and evaluation protocol are the same across rows; otherwise note the difference in the cell.

Always keep `Key` first. Add a final `Evidence` column when per-cell labels would clutter the table.

## Template

```markdown
# Literature matrix: <topic>

Scope: <how the paper set was chosen, e.g. "entries tagged `retrieval`, 9 papers">.
Sources: <e.g. "notes for 6 papers; BibTeX abstract only for 3 (marked †)">.

| Key | Year | Question / claim | Method | Data / setting | Main result | Limitations | Relevance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `smith2021` | 2021 | … [notes p.2] | … [notes p.4] | … [text] | +3.1 F1 over X on Y [notes p.7] | … [user] | … |
| `lee2023`† | 2023 | … [bib] | — | — | — | — | … |

† Abstract only; method and results not verified.

## Synthesis

- **Agreements:** <findings that several papers share, with keys>
- **Disagreements:** <conflicting results or assumptions, with keys and the likely reason: data, metric, definition>
- **Gaps:** <what no paper in the set addresses>
- **Weakest cells:** <which rows or columns rest on thin evidence, and which paper to read or annotate to fix that>
```

## Rules for cells

- One row per paper; sort by theme first and year second unless the user wants another order.
- Keep cells to a phrase. Put longer explanations in the synthesis or in per-paper summaries.
- `—` means "no evidence available to me". `n/a` means "does not apply to this paper". Do not confuse them, and never fill a cell by analogy with neighbouring rows.
- Label each non-trivial cell (`[notes p.N]`, `[text]`, `[bib]`, `[user]`), or use the `Evidence` column.
- Numbers keep their unit, dataset, and comparison. Do not place two numbers in one column unless they measure the same thing under the same protocol; if protocols differ, say so in the cell.
- Escape `|` inside cells as `\|` and avoid line breaks so the table renders.
- The `Relevance` column is your reasoning about the user's project. It needs no evidence label, but it must follow from the other cells and from the manuscript.

## Synthesis rules

- Every statement names the keys it rests on.
- Do not count papers as agreeing when the evidence for some of them is abstract-only; say "per abstract".
- Report disagreement neutrally. Do not pick a winner unless the evidence in the table decides it.
- A gap is a claim about the set you examined, not about the whole field. Write "none of these nine papers …", not "no prior work …".

## Before saving

- [ ] Every key exists in the `.bib` and is spelled exactly.
- [ ] No cell is guessed; thin rows are marked.
- [ ] Columns mean the same thing in every row.
- [ ] The synthesis says nothing the table does not support.
- [ ] The table renders: same number of cells in each row, no raw `|` in cells.
