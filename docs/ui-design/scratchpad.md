# Yuuzu-IDE — deck outline

Audience: developers / technical users. Tone: technical, calm, confident (shadcn voice).
Visual: dark + yuzu-green, terminal aesthetic, matches the prototype.
Length: 10 slides. Title style: short topic noun-phrases.

Type scale (1920×1080):
--type-hero 108 / --type-title 66 / --type-subtitle 38 / --type-body 28 / --type-small 22 / --type-mono 22

## Title sequence (tells the story alone)
1. Yuuzu-IDE — cover (wordmark + tagline + version)
2. CLI-first, by design — the agent is the primary surface
3. One window, every surface — the shell anatomy (rail · panel · tabs · editor)
4. Claude Code is the core — the agent CLI (prompt → tools → diff → done)
5. Prompts you can export — reproducible workflows (Plan/Edit/Verify/System)
6. Databases, built in — SQLite · PostgreSQL · MS SQL Server
7. Remotes without leaving — SSH + SFTP
8. Browser & split view — preview beside your code
9. Tailored to your setup — theme · accent · density (tweaks)
10. See it live — embedded running prototype + closing

Design system: each content slide = eyebrow (kicker) + title + lean body, with a recreated
UI fragment (terminal / tree / diff / db grid / cards) carrying the visual weight.
Section parallelism: kicker top-left, title below, fragment right or full-bleed.
