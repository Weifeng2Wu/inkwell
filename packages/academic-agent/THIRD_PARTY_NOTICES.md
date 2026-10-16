# Third-party runtime attribution

Inkwell Agent uses an adapter around **NanoPi**, a fork of Pi Coding Agent,
from `NekoSekaiMoe/nanopi`. The exact source URL and revision are recorded in
`runtime-source.json`. The upstream runtime is distributed under the MIT license;
its license attributes copyright to Mario Zechner (2025).

The setup script downloads that source without renaming its internal package
identifiers or removing its license. Preserve the upstream `LICENSE` and applicable
dependency notices with any redistributed runtime artifacts. Inkwell Agent is this
project's product name, not a claim of independent authorship of the upstream core.

The runtime's transitive dependencies have their own licenses. Shipping a bundled
runtime requires including their applicable notices as part of release packaging.

The Skills library includes Research Paper Writing from
https://github.com/Master-cai/Research-Paper-Writing-Skills, initially bundled at
revision `77e7c2c1ba06f7d71844873147665437a03aac1b`. It is MIT-licensed,
Copyright (c) 2026 Master-cai. Its original license is preserved as `LICENSE.txt`
inside the bundled snapshot and every downloaded revision. Source updates are
retrieved as text resources; no upstream scripts are executed.

Nature Academic Writing Suite combines the writing, polishing, proposal, citation,
data-availability, statistics-reporting, response, reviewer and reference-verifier
modules, plus their nature-shared text references, from
https://github.com/Yuan1z0825/nature-skills at revision
`6827ae57b62b201acd06b401619050411c0d82f6`. These upstream texts are distributed
under Apache-2.0; their original license is retained as `LICENSE.txt` in the snapshot.
Inkwell adds a routing entrypoint and an integration notice; upstream text resources
are otherwise unmodified. Executable scripts and binary artifacts are not bundled.
External tool-dependent operations require separately available capabilities.
All bundled library entries require explicit installation and project activation.
