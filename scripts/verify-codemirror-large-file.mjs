#!/usr/bin/env bun

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import net from "node:net"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const vitePort = Number(process.env.YUZU_VERIFY_EDITOR_PORT ?? "1428")
const lineTotal = Number(process.env.YUZU_VERIFY_EDITOR_LINES ?? "10000")
const settingsKey = "yuuzu-ide-v2-settings"
const editorEngineMigrationKey = "yuuzu-ide-v2-editor-engine-default-codemirror-v1"
const chromeCandidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean)

function fail(message, detail) {
    console.error("editor-large-file verification failed: " + message)
    if (detail) console.error(detail)
    process.exitCode = 1
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function findChrome() {
    const found = chromeCandidates.find((candidate) => existsSync(candidate))
    if (found) return found
    throw new Error("Chrome executable not found. Set CHROME_BIN to a Chromium-compatible browser.")
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            server.close(() => resolve(address.port))
        })
    })
}

function killProcess(child) {
    if (!child || child.killed) return
    child.kill("SIGTERM")
}

async function waitForHttp(url, timeoutMs, logTail) {
    const deadline = Date.now() + timeoutMs
    let lastError = null
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url)
            if (res.ok) return res
            lastError = new Error("HTTP " + res.status)
        } catch (error) {
            lastError = error
        }
        await sleep(150)
    }
    throw new Error("Timed out waiting for " + url + "\n" + (lastError?.message ?? "") + "\n" + logTail())
}

async function createCdpPage(debugPort, appUrl) {
    const url = "http://127.0.0.1:" + debugPort + "/json/new?" + encodeURIComponent(appUrl)
    const deadline = Date.now() + 20000
    let lastError = null
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { method: "PUT" })
            if (res.ok) return res.json()
            lastError = new Error("HTTP " + res.status)
        } catch (error) {
            lastError = error
        }
        await sleep(150)
    }
    throw new Error("Timed out creating Chrome DevTools page\n" + (lastError?.message ?? ""))
}

function attachCdp(wsUrl) {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()
    const events = []

    ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id)
            pending.delete(msg.id)
            if (msg.error) reject(new Error(msg.error.message))
            else resolve(msg.result)
            return
        }
        events.push(msg)
    })

    const opened = new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true })
        ws.addEventListener("error", reject, { once: true })
    })

    async function send(method, params = {}) {
        await opened
        const id = nextId++
        const result = new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject })
        })
        ws.send(JSON.stringify({ id, method, params }))
        return result
    }

    async function waitForExpression(expression, timeoutMs) {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            const value = await evaluate(expression)
            if (value) return value
            await sleep(100)
        }
        throw new Error("Timed out waiting for expression: " + expression)
    }

    async function evaluate(expression) {
        const result = await send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
            timeout: 30000,
        })
        if (result.exceptionDetails) {
            const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
            throw new Error(text)
        }
        return result.result.value
    }

    return {
        send,
        waitForExpression,
        evaluate,
        close: () => ws.close(),
        events,
    }
}

function assertMetrics(metrics) {
    const failures = []
    const { before, after } = metrics
    if (!before.isCodemirrorBody || !after.isCodemirrorBody) failures.push("editor body did not use .is-codemirror")
    if (!before.cmEditor || !after.cmEditor) failures.push("CodeMirror editor was not mounted")
    if (before.textarea || after.textarea) failures.push("textarea fallback mounted unexpectedly")
    if (!before.engineSettingPresent || !after.engineSettingPresent) failures.push("legacy editorEngine setting was not loaded")
    if (before.engineSetting !== "codemirror" || after.engineSetting !== "codemirror") failures.push("legacy textarea setting did not migrate to CodeMirror")
    if (metrics.storageEditorEngine !== "codemirror") failures.push("persisted editorEngine did not migrate to CodeMirror")
    if (metrics.migrationMarker !== "1") failures.push("editor engine migration marker was not written")
    if (before.bodyScrollHeight > before.bodyClientHeight + 2) failures.push("outer editor body became the scrolling surface before scroll")
    if (after.bodyScrollHeight > after.bodyClientHeight + 2) failures.push("outer editor body became the scrolling surface after scroll")
    if (!(before.scrollerScrollHeight > before.scrollerClientHeight)) failures.push("CodeMirror scroller is not scrollable")
    if (!(after.scrollerScrollTop > 0)) failures.push("CodeMirror scroller did not scroll")
    if (before.cmLineCount > 200) failures.push("too many CodeMirror line nodes before scroll: " + before.cmLineCount)
    if (after.cmLineCount > 200) failures.push("too many CodeMirror line nodes after scroll: " + after.cmLineCount)
    if (!String(after.lastLine ?? "").includes("value" + lineTotal)) failures.push("last visible CodeMirror line did not reach line " + lineTotal)
    if (failures.length) {
        throw new Error(failures.join("\n"))
    }
}

async function main() {
    const viteLogs = []
    const profileDir = mkdtempSync(join(tmpdir(), "yuuzu-cm-"))
    const debugPort = await freePort()
    let vite = null
    let chrome = null
    let cdp = null

    try {
        vite = spawn("bun", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
        })
        const captureVite = (chunk) => {
            viteLogs.push(String(chunk))
            if (viteLogs.length > 40) viteLogs.shift()
        }
        vite.stdout.on("data", captureVite)
        vite.stderr.on("data", captureVite)

        const appUrl = "http://127.0.0.1:" + vitePort + "/"
        await waitForHttp(appUrl, 20000, () => viteLogs.join(""))

        const chromePath = findChrome()
        chrome = spawn(chromePath, [
            "--headless=new",
            "--disable-gpu",
            "--disable-background-networking",
            "--disable-extensions",
            "--remote-debugging-port=" + debugPort,
            "--user-data-dir=" + profileDir,
            "about:blank",
        ], { stdio: ["ignore", "ignore", "ignore"] })

        const target = await createCdpPage(debugPort, appUrl)
        cdp = attachCdp(target.webSocketDebuggerUrl)
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.waitForExpression("document.readyState === 'complete' && document.title === 'Yuuzu-IDE'", 20000)
        await cdp.evaluate(`
            (() => {
                localStorage.removeItem(${JSON.stringify(editorEngineMigrationKey)})
                localStorage.setItem(${JSON.stringify(settingsKey)}, JSON.stringify({ editorEngine: "textarea" }))
                return true
            })()
        `)
        await cdp.send("Page.navigate", { url: appUrl })
        await cdp.waitForExpression(
            "document.readyState === 'complete' && document.title === 'Yuuzu-IDE' && localStorage.getItem(" +
                JSON.stringify(editorEngineMigrationKey) +
                ") === '1'",
            20000,
        )

        const probeExpression = `
            (async () => {
                const mod = await import("/src/v2/v2-store.ts")
                const v2Store = mod.v2Store
                const content = Array.from({ length: ${lineTotal} }, (_, i) =>
                    "export const value" + (i + 1) + " = " + i + "; // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                ).join("\\n")
                const tab = {
                    id: 900001,
                    type: "file",
                    name: "Huge.ts",
                    path: "src/Huge.ts",
                    realPath: "/tmp/Huge.ts",
                    content,
                    contentLang: "typescript",
                    savedContent: content,
                    version: { modified_ms: 1, len: content.length },
                }
                const state = v2Store.getState()
                const pid = state.active || "api"
                v2Store.setState({
                    active: pid,
                    mode: "real",
                    ui: {
                        ...state.ui,
                        [pid]: {
                            ...state.ui[pid],
                            tabs: [tab],
                            activeTab: tab.id,
                            split: null,
                            diagnosticsByPath: {},
                        },
                    },
                })
                await new Promise((resolve) => setTimeout(resolve, 700))
                const sample = () => {
                    const body = document.querySelector(".yz2-ed-body")
                    const cm = document.querySelector(".cm-editor")
                    const scroller = document.querySelector(".cm-scroller")
                    const lines = Array.from(document.querySelectorAll(".cm-line"))
                    const textarea = document.querySelector("textarea")
                    const current = v2Store.getState()
                    return {
                        bodyClass: body?.className ?? null,
                        isCodemirrorBody: !!body?.classList.contains("is-codemirror"),
                        cmEditor: !!cm,
                        textarea: !!textarea,
                        bodyClientHeight: body?.clientHeight ?? 0,
                        bodyScrollHeight: body?.scrollHeight ?? 0,
                        scrollerClientHeight: scroller?.clientHeight ?? 0,
                        scrollerScrollHeight: scroller?.scrollHeight ?? 0,
                        scrollerScrollTop: scroller?.scrollTop ?? 0,
                        cmLineCount: lines.length,
                        firstLine: lines[0]?.textContent?.slice(0, 80) ?? null,
                        lastLine: lines.at(-1)?.textContent?.slice(0, 80) ?? null,
                        engineSettingPresent: Object.prototype.hasOwnProperty.call(current.stVals, "editorEngine"),
                        engineSetting: current.stVals.editorEngine ?? null,
                    }
                }
                const before = sample()
                const scroller = document.querySelector(".cm-scroller")
                if (scroller) {
                    scroller.scrollTop = scroller.scrollHeight
                    scroller.dispatchEvent(new Event("scroll", { bubbles: true }))
                }
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                await new Promise((resolve) => setTimeout(resolve, 300))
                const after = sample()
                const stored = JSON.parse(localStorage.getItem(${JSON.stringify(settingsKey)}) ?? "{}")
                return {
                    lineTotal: ${lineTotal},
                    contentLength: content.length,
                    storageEditorEngine: stored.editorEngine ?? null,
                    migrationMarker: localStorage.getItem(${JSON.stringify(editorEngineMigrationKey)}),
                    before,
                    after,
                }
            })()
        `
        const metrics = await cdp.evaluate(probeExpression)
        assertMetrics(metrics)
        console.log(JSON.stringify(metrics, null, 2))
    } finally {
        cdp?.close()
        killProcess(chrome)
        killProcess(vite)
        rmSync(profileDir, { recursive: true, force: true })
    }
}

try {
    await main()
} catch (error) {
    fail(error.message, error.stack)
}
