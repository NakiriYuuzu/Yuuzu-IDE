/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { extractReleaseNotes } from "./extract-release-notes.mjs"

describe("extractReleaseNotes", () => {
    test("extracts the matching version section from Keep a Changelog markdown", () => {
        const changelog = `# Changelog

## [Unreleased]

- Work in progress

## [0.2.0] - 2026-06-22

### Added

- Windows portable zip.
- Settings update notes.

## [0.1.0] - 2026-06-15

- Initial release.
`

        expect(extractReleaseNotes(changelog, "v0.2.0")).toBe(`### Added

- Windows portable zip.
- Settings update notes.`)
    })

    test("returns a stable fallback when the version section is missing", () => {
        expect(extractReleaseNotes("# Changelog\n\n## [Unreleased]\n\n- Next", "v9.9.9")).toBe(
            "Release notes are not available for v9.9.9.",
        )
    })
})
