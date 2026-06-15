import { describe, expect, test } from "bun:test"
import { externallyChangedTabIds, findByReal, isTempWritePath, mergeTreeChildren, normalizeFsPath, treeRefreshTarget } from "./file-watch"
import type { Tab, TreeNode } from "./v2-model"

const fileTab = (over: Partial<Tab>): Tab => ({ id: 1, type: "file", ...over })
const v = (modified_ms: number, len: number) => ({ modified_ms, len })

describe("normalizeFsPath", () => {
    test("strips windows verbatim prefix, normalizes slashes and case", () => {
        expect(normalizeFsPath("\\\\?\\C:\\Users\\X\\a.ts")).toBe("c:/users/x/a.ts")
    })
    test("matches std (verbatim) vs dunce (plain) canonical forms", () => {
        expect(normalizeFsPath("\\\\?\\C:\\proj\\a.ts")).toBe(normalizeFsPath("C:\\proj\\a.ts"))
    })
    test("drops trailing slashes", () => {
        expect(normalizeFsPath("/home/x/proj/")).toBe("/home/x/proj")
    })
    test("matches verbatim UNC against plain UNC", () => {
        expect(normalizeFsPath("\\\\?\\UNC\\server\\share\\a.ts")).toBe("//server/share/a.ts")
        expect(normalizeFsPath("\\\\?\\UNC\\server\\share\\a.ts")).toBe(normalizeFsPath("\\\\server\\share\\a.ts"))
    })
    test("case-folds windows drive paths", () => {
        expect(normalizeFsPath("C:\\Proj\\A.ts")).toBe("c:/proj/a.ts")
    })
    test("preserves case for posix paths", () => {
        expect(normalizeFsPath("/repo/Foo.ts")).toBe("/repo/Foo.ts")
        expect(normalizeFsPath("/repo/Foo.ts")).not.toBe(normalizeFsPath("/repo/foo.ts"))
    })
})

describe("externallyChangedTabIds", () => {
    test("flags a matching file tab whose version changed", () => {
        const tabs = [fileTab({ id: 7, realPath: "/r/a.ts", version: v(1, 10) })]
        expect(externallyChangedTabIds(tabs, "/r/a.ts", v(2, 12))).toEqual([7])
    })
    test("ignores a matching tab whose version is unchanged (self-save echo)", () => {
        const tabs = [fileTab({ id: 7, realPath: "/r/a.ts", version: v(2, 12) })]
        expect(externallyChangedTabIds(tabs, "/r/a.ts", v(2, 12))).toEqual([])
    })
    test("flags when event version is null (delete / unreadable)", () => {
        const tabs = [fileTab({ id: 7, realPath: "/r/a.ts", version: v(2, 12) })]
        expect(externallyChangedTabIds(tabs, "/r/a.ts", null)).toEqual([7])
    })
    test("matches across verbatim and plain windows path forms", () => {
        const tabs = [fileTab({ id: 7, realPath: "C:\\proj\\a.ts", version: v(1, 10) })]
        expect(externallyChangedTabIds(tabs, "\\\\?\\C:\\proj\\a.ts", v(2, 20))).toEqual([7])
    })
    test("does not match unrelated paths", () => {
        const tabs = [fileTab({ id: 7, realPath: "/r/a.ts", version: v(1, 10) })]
        expect(externallyChangedTabIds(tabs, "/r/b.ts", v(2, 20))).toEqual([])
    })
    test("falls back to path when realPath absent; ignores non-file tabs", () => {
        const tabs = [fileTab({ id: 7, path: "/r/a.ts", version: v(1, 10) }), { id: 8, type: "cmd" } as Tab]
        expect(externallyChangedTabIds(tabs, "/r/a.ts", v(2, 20))).toEqual([7])
    })
    test("does not flag a tab with no known version (still loading)", () => {
        const tabs = [fileTab({ id: 7, realPath: "/r/a.ts" })]
        expect(externallyChangedTabIds(tabs, "/r/a.ts", v(2, 12))).toEqual([])
    })
    test("does not conflate posix paths differing only by case", () => {
        const tabs = [
            fileTab({ id: 7, realPath: "/repo/Foo.ts", version: v(1, 10) }),
            fileTab({ id: 8, realPath: "/repo/foo.ts", version: v(1, 10) })
        ]
        expect(externallyChangedTabIds(tabs, "/repo/foo.ts", v(2, 20))).toEqual([8])
    })
})

const fdir = (n: string, p: string, d: TreeNode[] = [], loaded = true): TreeNode => ({ n, p, d, loaded })
const ffile = (n: string, p: string): TreeNode => ({ n, p })

describe("isTempWritePath", () => {
    test("matches the atomic-write temp pattern .<name>.<pid>.<counter>.tmp", () => {
        expect(isTempWritePath("/r/src/.main.ts.12345.0.tmp")).toBe(true)
    })
    test("does not match ordinary files or dotfiles", () => {
        expect(isTempWritePath("/r/src/main.ts")).toBe(false)
        expect(isTempWritePath("/r/.env")).toBe(false)
        expect(isTempWritePath("/r/.foo.tmp")).toBe(false)
    })
})

describe("findByReal", () => {
    const nested = ffile("a.ts", "/r/src/a.ts")
    const src = fdir("src", "/r/src", [nested])
    const tree = [src, ffile("top.ts", "/r/top.ts")]
    test("returns the node and display path for a nested real path", () => {
        const found = findByReal(tree, "/r/src/a.ts")
        expect(found?.node).toBe(nested)
        expect(found?.displayPath).toBe("src/a.ts")
    })
    test("returns the dir node itself", () => {
        const found = findByReal(tree, "/r/src")
        expect(found?.node).toBe(src)
        expect(found?.displayPath).toBe("src")
    })
    test("does not descend into non-ancestor dirs", () => {
        const misplaced = ffile("alien.ts", "/r/src-other/alien.ts")
        const limitedTree = [fdir("src", "/r/src", [misplaced])]
        expect(findByReal(limitedTree, "/r/src-other/alien.ts")).toBeNull()
    })
    test("returns null for an unknown path", () => {
        expect(findByReal(tree, "/r/src/missing.ts")).toBeNull()
    })
})

describe("treeRefreshTarget", () => {
    const tree = [
        fdir("src", "/r/src", [ffile("a.ts", "/r/src/a.ts")]),
        fdir("node_modules", "/r/node_modules", [], false), // unloaded
        ffile("top.ts", "/r/top.ts")
    ]
    const ROOT = "/r"
    test("create in a loaded dir → refresh that dir", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/src/new.ts", true)).toBe("src")
    })
    test("delete a known file → refresh its parent dir", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/src/a.ts", false)).toBe("src")
    })
    test("modify an existing file → no structural refresh", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/src/a.ts", true)).toBeNull()
    })
    test("root-level change → refresh root (empty string)", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/added.ts", true)).toBe("")
    })
    test("create inside an unloaded dir → skip", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/node_modules/x/y.js", true)).toBeNull()
    })
    test("temp write file → skip", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/src/.a.ts.999.0.tmp", true)).toBeNull()
    })
})

describe("mergeTreeChildren", () => {
    test("preserves a surviving dir's loaded subtree and drops removed nodes", () => {
        const old = [fdir("src", "/r/src", [ffile("a.ts", "/r/src/a.ts")]), ffile("old.ts", "/r/old.ts")]
        const fresh = [fdir("src", "/r/src", [], false), ffile("new.ts", "/r/new.ts")]
        const merged = mergeTreeChildren(old, fresh)
        const src = merged.find((n) => n.n === "src")
        expect(src?.d).toHaveLength(1) // preserved a.ts, not reset to []
        expect(src?.loaded).toBe(true)
        expect(merged.map((n) => n.n)).toEqual(["src", "new.ts"]) // old.ts dropped
    })
    test("matches surviving dirs by name rather than path or object identity", () => {
        const child = ffile("nested.ts", "/old/src/nested.ts")
        const oldSrc = fdir("src", "/old/src", [child])
        const freshSrc = fdir("src", "/fresh/src", [], false)
        const freshOther = fdir("other", "/old/src", [], false)
        const merged = mergeTreeChildren([oldSrc], [freshSrc, freshOther])
        expect(merged[0]).not.toBe(oldSrc)
        expect(merged[0].p).toBe("/fresh/src")
        expect(merged[0].d).toEqual([child])
        expect(merged[0].loaded).toBe(true)
        expect(merged[1].d).toEqual([])
        expect(merged[1].loaded).toBe(false)
    })
})
