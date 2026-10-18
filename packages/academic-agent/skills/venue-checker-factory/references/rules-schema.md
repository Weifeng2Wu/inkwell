# rules.json schema

Fill only what the kit actually states. A missing key means "do not check"; never guess a value from memory of what this venue "usually" requires,
because a wrong rule produces false alarms that teach the user to ignore the report. Every block carries `_sources`: a short pointer to the kit
passage (file, page or section, plus a few words of the original) for each rule, so a human can verify it in seconds.

Units: lengths in `margins` use `unit` (`in`, `cm`, `mm`, `pt`). Sizes are in pt.

```jsonc
{
  "venue": "ACL 2027",                 // shown in the report title
  "default_phase": "review",           // phase used when --phase is not given
  "phases": {                          // overrides deep-merged on top of the base rules
    "review": {"anonymity": {"required": true}, "pdf": {"line_numbers": "required"}},
    "final":  {"anonymity": {"required": false}, "pdf": {"line_numbers": "forbidden", "page_limit": {"main_body": 9}}}
  },

  "pdf": {                             // checks on the compiled PDF
    "page_size": "A4",                 // "A4" | "Letter"
    "page_limit": {
      "main_body": 8,                  // pages of content that count
      "total": null,                   // hard cap on all pages, if the kit has one
      "main_body_ends_at": ["Limitations", "Ethics.*", "References"]   // regexes for heading lines that end the counted part
    },
    "margins": {"unit": "cm", "top": 2.5, "bottom": 2.5, "left": 2.5, "right": 2.5,
                "tolerance_pt": 3, "skip_top_pt": 0, "skip_bottom_pt": 0},
    "fonts": {
      "allowed_families": ["Times", "NimbusRom"],   // substrings, case/punctuation-insensitive; math fonts are always allowed
      "body_size_pt": 11, "min_size_pt": 8,
      "require_embedded": true, "forbid_type3": false
    },
    "line_numbers": "required",        // "required" | "forbidden" | null
    "_sources": {"page_size": "...", "page_limit": "...", "margins": "...", "fonts": "...", "line_numbers": "..."}
  },

  "tex": {                             // checks on the LaTeX source
    "documentclass": {"name": "article", "options_required": ["11pt"], "options_forbidden": []},
    "packages_required": [{"name": "acl", "options_required": ["review"], "options_forbidden": ["final"]}],
    "packages_forbidden": ["geometry"],         // omit to use the default list (savetrees, fullpage, setspace, titlesec)
    "allow_packages": [],                       // exempt from the forbidden list (e.g. the template itself loads geometry)
    "forbid_layout_hacks": true,                // negative \vspace, \baselinestretch, \setlength{\textwidth}, \geometry ...
    "layout_hacks_severity": "warn",            // "error" if the kit says deviations are rejected
    "bibliography_style": ["acl_natbib"],
    "official_files": {"acl.sty": {}, "acl_natbib.bst": {}},   // hashes are filled in from the kit by build_venue_skill.py
    "_sources": {"documentclass": "...", "packages_required": "...", "official_files": "..."}
  },

  "docx": {                            // Word submissions
    "page_size": "Letter", "margins": {"unit": "in", "top": 1, "bottom": 1, "left": 1, "right": 1},
    "fonts": {"allowed_families": ["Times New Roman"], "body_size_pt": 10},
    "line_spacing": 1.0, "page_limit": 6,
    "_sources": {}
  },

  "anonymity": {                       // applies to PDF and source when required
    "required": true,
    "forbid_text_patterns": ["our (previous|prior) work"],     // optional extra regexes
    "forbid_headings": ["Acknowledg(e)?ments?"],
    "_sources": {"required": "..."}
  },

  "checklist": [                       // content requirements the kit imposes
    {
      "id": "limitations",             // short slug, unique
      "title": "Limitations section",
      "severity": "error",             // "error" | "warn"  (error = the kit says missing => desk reject)
      "source": "kit/acl_cfp.pdf p.3: 'papers without a Limitations section will be desk rejected'",
      "description": "what a human/LLM must verify; used for manual items",
      "needs_judgement": false,        // true: even when detected, still list as a manual check
      "detect": [                      // tried in order; first applicable one wins
        {"type": "tex_section", "title_regex": "Limitations", "min_words": 40},
        {"type": "pdf_regex", "patterns": ["^\\s*(\\d+\\s+)?Limitations\\s*$"]}
      ],
      "fix": "Add \\section*{Limitations} after the conclusion (does not count toward the page limit)."
    }
  ]
}
```

`detect` types: `tex_section` (title regex + minimum words, approximate), `tex_regex` (patterns searched in the comment-stripped source),
`pdf_regex` (patterns searched in the PDF text; `^`/`$` work per line). Add `"expect": "absent"` to a regex detector to require that
something is NOT present. Items without `detect`, or whose input type was not supplied, become manual checks.

## Translating kit language into rules

| Kit says | Put in rules |
|---|---|
| "8 pages of content, unlimited references" | `page_limit.main_body: 8`, `main_body_ends_at: ["References"]` |
| "Limitations/Ethics sections do not count" | add their headings to `main_body_ends_at` **and** a checklist item if mandatory |
| "text area 6.75 x 9 in on Letter" | margins: `(8.5-6.75)/2 = 0.875` left/right; `(11-9)/2 = 1.0` top/bottom, `unit: "in"` (say in `_sources` that it was derived) |
| "Times New Roman 10pt" | `fonts.allowed_families: ["Times","NimbusRom"]` (LaTeX `times`/`newtx` render as Nimbus), `body_size_pt: 10` |
| "all fonts must be Type 1 / embedded" | `require_embedded: true`, `forbid_type3: true` |
| "do not modify the style file / margins / spacing" | `official_files` for each .sty/.cls/.bst, `forbid_layout_hacks: true`, `layout_hacks_severity: "error"` |
| "submissions must be anonymous" | phase `review`: `anonymity.required: true` (+ review option in `packages_required`) |
| "include a reproducibility / responsible-NLP checklist" | checklist item, `severity: "error"`, usually manual unless the checklist is a fixed .tex block you can regex |
| "should", "recommended", "encouraged" | `severity: "warn"` |
| "must", "will be rejected", "required" | `severity: "error"` |

## Traps

- Review and camera-ready kits differ (page limit +1, no line numbers, authors shown). Always model phases; ask the user which one they are submitting.
- Different tracks (long/short/demo, main/industry) have different limits: ask which track, or build one skill per track by passing `--name` suffixes.
- If the LaTeX style file is the ground truth (e.g. it computes `\textwidth`), prefer `official_files` + the compiled-PDF checks over re-deriving numbers by hand.
- When the PDF kit and the style file disagree, trust the style file for geometry and the PDF for policy, and note the conflict in `kit_notes.md`.
- Heading regexes in `main_body_ends_at` match a whole line, so `"References"` will not match `"References and Notes"`; list variants.
