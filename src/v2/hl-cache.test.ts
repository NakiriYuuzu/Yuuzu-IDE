/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import { evictHlCache, hlCacheSize, highlightContent } from "./hl-cache"
import type { Tab } from "./v2-model"
import { v2Store } from "./v2-store"

afterEach(() => {
    // 清掉每個測試留下的快取(用 delta 斷言,故只需確保自家 id 不殘留)
    evictHlCache(701)
    evictHlCache(702)
    evictHlCache(777)
})

describe("hl-cache", () => {
    test("highlightContent caches per tab id and returns a stable reference", () => {
        const a = highlightContent(701, "const a = 1\nconst b = 2\n", "ts")
        const b = highlightContent(701, "const a = 1\nconst b = 2\n", "ts")
        expect(b).toBe(a) // 同 key → 同一個 reference(命中快取)
        expect(a.length).toBe(3) // 兩行內容 + 結尾空行
    })

    test("evictHlCache removes the entry", () => {
        const before = hlCacheSize()
        highlightContent(701, "x\n", "ts")
        highlightContent(702, "y\n", "ts")
        expect(hlCacheSize()).toBe(before + 2)
        evictHlCache(701)
        expect(hlCacheSize()).toBe(before + 1)
    })
})

describe("hl-cache wiring with v2-store", () => {
    const initialApiUI = structuredClone(v2Store.getState().ui.api)

    afterEach(() => {
        v2Store.setState((s) => ({
            mode: "demo",
            active: "api",
            ui: { ...s.ui, api: structuredClone(initialApiUI) },
        }))
    })

    test("closeTab evicts the highlight cache for the closed tab", () => {
        const tab = {
            id: 777,
            type: "file" as const,
            name: "z.ts",
            path: "z.ts",
            realPath: "/workspace/z.ts",
            content: "const z = 1\nconst y = 2\n",
            savedContent: "const z = 1\nconst y = 2\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => ({
            mode: "demo",
            active: "api",
            ui: {
                ...s.ui,
                api: { ...structuredClone(initialApiUI), tabs: [tab as unknown as Tab], activeTab: tab.id },
            },
        }))

        highlightContent(tab.id, tab.content, "ts")
        const had = hlCacheSize()
        expect(had).toBeGreaterThanOrEqual(1)

        v2Store.getState().closeTab(tab.id)
        expect(hlCacheSize()).toBe(had - 1)
    })
})
