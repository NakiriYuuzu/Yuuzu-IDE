/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import { extractTerminalOscTitles, resetTerminalOscTitleParserForTests } from "./controller"

afterEach(() => {
    resetTerminalOscTitleParserForTests()
})

describe("terminal OSC title parsing", () => {
    test("extracts BEL and ST terminated window titles", () => {
        expect(extractTerminalOscTitles("term-a", "pre\x1b]0;vim src/App.tsx\x07post")).toEqual(["vim src/App.tsx"])
        expect(extractTerminalOscTitles("term-a", "\x1b]2;claude session\x1b\\")).toEqual(["claude session"])
    })

    test("extracts a title split across output chunks", () => {
        expect(extractTerminalOscTitles("term-a", "pre\x1b]0;split")).toEqual([])
        expect(extractTerminalOscTitles("term-a", " title\x07post")).toEqual(["split title"])
    })

    test("keeps incomplete titles scoped to their session", () => {
        expect(extractTerminalOscTitles("term-a", "\x1b]0;alpha")).toEqual([])
        expect(extractTerminalOscTitles("term-b", " plain output\x07")).toEqual([])
        expect(extractTerminalOscTitles("term-a", " title\x07")).toEqual(["alpha title"])
    })
})
