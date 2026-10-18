# Inkwell integration

Source: the user-supplied `venue-checker-factory.skill` archive (2026-10-18).
Rebuild its offline snapshot with `node scripts/bundle-venue-factory.mjs`.

The format builder supplies SKILL.md and the rules schema to the selected model.
It collects clarification answers, verifies literal source quotes, previews the
rules and packages the generic engine after confirmation. Machine-rule sources
use preview rule IDs during generation; Inkwell resolves them to original quotes.
Recommendations and checks that cannot be encoded faithfully remain manual items.
Official style copies keep the uploaded text; their hashes normalize CRLF exactly
as the Python engine does. Importing scripts stores text and never executes them.

The desktop builder uses its existing PDF parser and author-kit ZIP reader in
place of extract_kit.py. It assembles the skill in Node without requiring Python
or Claude-specific directories, package_skill, or present_files. Existing saved
skills stay available; newly generated skills use this factory.

Local engine changes: absent forbid_layout_hacks and require_embedded flags now
default to false. The kit must explicitly require those checks. The upstream
factory workflow, schema, builder and extraction scripts are retained as reference.

Calibration is not part of text-only extraction. Generated skills and the preview
state that official-sample and mutation controls have not run. The built-in Agent
can execute the enabled skill's verified script with run_python in ask/auto modes.
Restricted mode disables Python. Missing interpreters, dependencies or unperformed
checks must be reported as NOT VERIFIED. External Agents with execution tools can
also materialize declared resources and run the engine.
Python dependencies and TeX/LibreOffice availability are separate
from Skill generation; the application does not install them automatically.
