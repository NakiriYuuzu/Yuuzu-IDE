# Yuuzu-IDE Project Skills

These repo-local skills capture Yuuzu-IDE testing workflows so future agents can add regression coverage and run verification without rebuilding the process from scratch.

Use the most specific skill for the task:

- `yuuzu-ide-verification-planner`: choose the smallest credible verification gate for a Yuuzu-IDE change.
- `yuuzu-ide-focused-regression-tests`: add or update focused Bun/Rust regression tests before a fix.
- `yuuzu-ide-tauri-debug-smoke`: build and verify the packaged debug app with real runtime smoke checks.
- `yuuzu-ide-release-manager`: prepare, validate, tag, inspect, and publish Yuuzu-IDE releases with updater/latest.json checks.
- `yuuzu-ide-skill-eval-feedback`: evaluate these testing skills and report which test methods should be improved.

Each skill owns `evals/evals.json`. The eval files contain realistic prompts, expected results, and checkable expectations. Run full with-skill/baseline eval loops only when the user explicitly asks for skill eval execution; otherwise validate the files statically and keep the evals ready for the next iteration.
