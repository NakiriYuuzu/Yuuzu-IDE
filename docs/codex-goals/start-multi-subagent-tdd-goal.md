# Start Multi-Subagent TDD Roadmap Goal

Use this file when you want to start the long-running Codex Goal for Yuuzu-IDE.

## One-Line Command

Paste this exact command into Codex CLI/TUI:

```text
/goal Execute docs/codex-goals/multi-subagent-tdd-roadmap.md exactly: implement roadmap.md from Node 0 through Node 13 in order. First read that file, roadmap.md, docs/architecture/tech-stack.md, docs/ui-design/, and docs/superpowers/plans/2026-06-08-node-0-architecture-spike.md. For Node 0 execute the existing plan; for each later node first use superpowers:writing-plans to create a concrete plan, then use superpowers:subagent-driven-development with implementer, spec-compliance reviewer, and code-quality reviewer, and require superpowers:test-driven-development red/green/refactor evidence for every behavior change. Frontend implementation must use docs/ui-design/ as the UI design source of truth. During this goal, git staging and commit operations are authorized inside /Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide only; commit after each verified roadmap node or coherent milestone. Use parallel subagents only for independent non-overlapping tasks or research steps whose file boundaries are explicit. Continue node by node, updating docs/architecture/progress.md and roadmap.md after each node, until all roadmap acceptance criteria pass or an exact blocker is reported.
```

## If The Command Does Not Appear

Official Codex docs say `/goal` requires a Codex build that supports Goals and,
when the slash command is not visible, `features.goals = true` in
`~/.codex/config.toml`.

This machine has been updated with:

```toml
[features]
goals = true
```

Restart Codex after changing config if the slash command list still does not
show `/goal`.

## Goal Controls

Use these commands from the same Codex thread:

```text
/goal
/goal pause
/goal resume
/goal clear
```

## Why This File Exists

`/goal` is triggered by `/goal <objective>` on the command line. A markdown file
that contains `/goal` alone followed by sections is easy for a human to read but
can fail as an actual trigger. This file keeps the trigger as one paste-ready
command and points Codex at the detailed operating contract.

## Sources

- OpenAI Codex docs: https://developers.openai.com/codex/use-cases/follow-goals
- OpenAI Cookbook: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
