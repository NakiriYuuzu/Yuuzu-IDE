import fs from "node:fs"
import { fileURLToPath } from "node:url"

function normalizeVersion(version) {
    return version
        .trim()
        .replace(/^refs\/tags\//, "")
        .replace(/^v/, "")
}

function fallbackNotes(tag) {
    return `Release notes are not available for ${tag}.`
}

export function extractReleaseNotes(changelog, tag) {
    const version = normalizeVersion(tag)
    const headings = [...changelog.matchAll(/^##\s+(?:\[([^\]]+)\]|([^\n]+?))(?:\s+-\s+.*)?\s*$/gm)]

    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index]
        const title = (heading[1] ?? heading[2] ?? "").split(" - ")[0]
        if (normalizeVersion(title) !== version) continue

        const start = (heading.index ?? 0) + heading[0].length
        const end = index + 1 < headings.length ? headings[index + 1].index ?? changelog.length : changelog.length
        const notes = changelog.slice(start, end).trim()
        return notes || fallbackNotes(tag)
    }

    return fallbackNotes(tag)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const tag = process.argv[2]
    if (!tag) {
        console.error("usage: node scripts/extract-release-notes.mjs <tag>")
        process.exit(1)
    }
    const changelog = fs.readFileSync("CHANGELOG.md", "utf8")
    process.stdout.write(extractReleaseNotes(changelog, tag))
}
