// Highlighted-line cache for real file contents, keyed per tab.
// Extracted from ContentViews so tab teardown can evict entries and stop the
// map from growing unbounded across a long multi-workspace session.

import { hlLine } from "./v2-model"
import type { Seg } from "./v2-model"

export type HlLines = { n: number; segs: Seg[] }[]

const realHlCache = new Map<number, { key: string; lines: HlLines }>()

export function highlightContent(tabId: number, content: string, lang: string): HlLines {
    const key = lang + ":" + content.length + ":" + content.slice(0, 80)
    const hit = realHlCache.get(tabId)
    if (hit && hit.key === key) return hit.lines
    const rawLines = content.split("\n")
    const plain = rawLines.length > 3000
    const lines = rawLines.map((l, i) => ({
        n: i + 1,
        segs: plain ? [{ c: "var(--yz-dbe4ec)", s: l || " " }] : hlLine(l, lang),
    }))
    realHlCache.set(tabId, { key, lines })
    return lines
}

export function evictHlCache(tabId: number): void {
    realHlCache.delete(tabId)
}

export function hlCacheSize(): number {
    return realHlCache.size
}
