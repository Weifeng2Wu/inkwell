# Related-work writing checklist

Use this when drafting or revising a related-work, background, or literature-review section. Work through the three stages in order; do not start writing prose before the plan exists.

## 1. Plan

- [ ] **Know the contribution.** Read the manuscript's abstract, introduction, and contribution list. State in one sentence what the user's work does that prior work does not. If you cannot, ask the user.
- [ ] **Know the constraints.** Target file and section, venue or length limit if stated, language, and the citation command the manuscript already uses (`\cite`, `\citep`/`\citet`, `\autocite`/`\textcite`, or Markdown `[@key]`). Match the existing style; do not introduce a new one.
- [ ] **Inventory the evidence.** For each candidate key, note what you hold: notes with pages, supplied text, abstract only, or title only. A title-only entry can support at most "X studies Y", and only if the title says so.
- [ ] **Choose the themes.** Group papers by what they have in common that matters to the user's contribution: the problem they address, the approach they take, the assumption they make, or the position they hold in a debate. Two to five themes is typical. A paper may appear in more than one.
- [ ] **Outline each theme** as: the point of the paragraph, the keys that support it, how the thread relates to the user's work. Share the outline with the user when the section is long or the grouping is debatable.

## 2. Write

Paragraph pattern:

1. **Topic sentence** naming the theme and the point, not a paper.
2. **Grouped evidence**: what this line of work does or finds, with citations clustered by shared property. Single out an individual paper only when it is pivotal or differs in a way that matters.
3. **Contrast or limitation** common to the group, stated at the strength the evidence allows.
4. **Positioning**: how the user's work differs from, builds on, or complements this thread, in specific terms.

Example of the shape (keys are placeholders, not real references):

```latex
\paragraph{Retrieval-augmented generation.}
A first line of work conditions the generator on retrieved passages at
inference time \citep{keyA,keyB}, which improves factual accuracy on
open-domain benchmarks \citep{keyA} but leaves the retriever fixed.
Later systems train both components jointly \citep{keyC,keyD}.
% TODO(evidence): confirm in keyD that joint training is end-to-end
In contrast, our approach \ldots
```

Rules while writing:

- **Themes, not a list.** Avoid a run of sentences that each begin with an author name and a verb. If a paragraph could be reordered sentence by sentence without loss, it is a list; rewrite it around a point.
- **Only existing keys.** Every key must be defined in the project's `.bib` files, with exact spelling and case. Never invent a key, and never write a citation as free text ("Smith et al., 2021") to get around a missing entry.
- **Citation placement.** Put the citation next to the claim it supports, not in a pile at the end of the paragraph. Use textual forms (`\citet`, `\textcite`) when the authors are the grammatical subject, and only if the manuscript uses those packages.
- **Claim strength follows evidence.**
  - Notes or supplied text support specific claims about methods and results.
  - An abstract supports what the abstract states, at that level of generality.
  - A title supports the topic only.
  - Nothing supports claims of priority ("the first to"), completeness ("no prior work"), or consensus ("it is well known") unless a source in hand says so. Prefer bounded wording: "to our knowledge", "among the approaches we survey".
- **Numbers and quotes.** Include a number from another paper only when you hold it with its conditions, and cite it. Direct quotation is rare in related work; if used, it must be verbatim, with a page where the style allows.
- **Fairness.** Describe other work in terms its authors would accept. State limitations as scope ("does not address …", "evaluated only on …") that you can support, not as defects you assume.
- **The user's work.** Claims about the user's own contribution must match the manuscript. Do not promise results the manuscript does not report.
- **Flag, do not bluff.** When a sentence needs evidence you lack, either weaken it to what you can support or keep it and mark it: `% TODO(evidence): confirm in <key>, <what to check>` in LaTeX, `<!-- TODO(evidence): … -->` in Markdown. One marker per unsupported claim.
- **Missing sources.** When a theme needs a paper the library lacks, describe the kind of source needed and leave a `% TODO(source): …` marker. Do not name a specific paper from memory as if verified, and do not add `.bib` entries yourself.
- **Style.** Present tense for what papers state, past tense for what studies did. Keep paragraphs proportional to their importance for the contribution. No evaluative filler ("seminal", "groundbreaking") without a reason.

## 3. Verify before proposing the edit

- [ ] Run the citation audit on the new text: every key resolves; none is misspelled.
- [ ] Reread each sentence that cites a paper and point to the evidence for it. Anything unsupported is weakened or flagged.
- [ ] No evidence labels (`[notes p.N]` and the like) leaked into manuscript prose.
- [ ] No paper is described from memory alone.
- [ ] Each paragraph ends by connecting to the user's work, or the section has a closing paragraph that does so for all themes.
- [ ] The edit touches only the requested section; the preamble, other sections, and the `.bib` are unchanged.
- [ ] LaTeX compiles in principle: balanced braces, special characters escaped, no new packages required.

## What to tell the user afterwards

- The themes used and the keys cited under each.
- Every flagged claim, with the paper to read and what to look for there.
- Relevant library entries left out, and why (off-topic, or no usable evidence).
- Sources the section still needs that are not in the library.
- Where your evidence was abstract-only, so the user knows which statements to double-check first.
