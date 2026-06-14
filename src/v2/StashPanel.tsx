import { useEffect, useState } from "react"

import { useV2Store } from "./v2-store"
import type { GitStashEntry } from "../features/git/git-model"

const EMPTY_STASHES: GitStashEntry[] = []

function stashAge(whenUnix: number): string {
    const sec = Math.max(0, Math.floor(Date.now() / 1000) - whenUnix)
    if (sec < 60) return "now"
    if (sec < 3600) return Math.floor(sec / 60) + "m"
    if (sec < 86400) return Math.floor(sec / 3600) + "h"
    return Math.floor(sec / 86400) + "d"
}

function stashKey(stash: GitStashEntry): string {
    return stash.index + ":" + stash.when_unix + ":" + stash.message
}

export function StashPanel() {
    const open = useV2Store((s) => !!s.ui[s.active]?.stashPanelOpen)
    const stashes = useV2Store((s) => s.ui[s.active]?.git.stashes ?? EMPTY_STASHES)
    const closeStashPanel = useV2Store((s) => s.closeStashPanel)
    const stashChanges = useV2Store((s) => s.stashChanges)
    const applyStash = useV2Store((s) => s.applyStash)
    const popStash = useV2Store((s) => s.popStash)
    const dropStash = useV2Store((s) => s.dropStash)
    const stashToBranch = useV2Store((s) => s.stashToBranch)
    const [message, setMessage] = useState("")
    const [includeUntracked, setIncludeUntracked] = useState(false)
    const [branchStash, setBranchStash] = useState<{ key: string; index: number } | null>(null)
    const [branchName, setBranchName] = useState("")

    useEffect(() => {
        if (!open) {
            setMessage("")
            setIncludeUntracked(false)
            setBranchStash(null)
            setBranchName("")
        }
    }, [open])

    useEffect(() => {
        if (branchStash && !stashes.some((stash) => stashKey(stash) === branchStash.key && stash.index === branchStash.index)) {
            setBranchStash(null)
            setBranchName("")
        }
    }, [branchStash, stashes])

    if (!open) return null

    return (
        <>
            <div className="yz2-stash-backdrop" onClick={closeStashPanel} />
            <div className="yz2-stash-panel" role="dialog" aria-label="Stashes">
                <div className="yz2-stash-head">
                    <span>Stashes</span>
                    <button type="button" onClick={closeStashPanel}>Close</button>
                </div>
                <div className="yz2-stash-create">
                    <input
                        aria-label="Stash message"
                        placeholder="message"
                        value={message}
                        onChange={(event) => setMessage(event.currentTarget.value)}
                        onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.key === "Enter") {
                                stashChanges(message, includeUntracked)
                                setMessage("")
                            }
                        }}
                    />
                    <label>
                        <input
                            type="checkbox"
                            checked={includeUntracked}
                            onChange={(event) => setIncludeUntracked(event.currentTarget.checked)}
                        />
                        <span>Untracked</span>
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            stashChanges(message, includeUntracked)
                            setMessage("")
                        }}
                    >
                        Stash
                    </button>
                </div>
                <div className="yz2-stash-list">
                    {stashes.length ? (
                        stashes.map((stash) => (
                            <div key={stash.index + stash.message} className="yz2-stash-row">
                                <div className="main">
                                    <span className="idx">stash@{"{" + stash.index + "}"}</span>
                                    <span className="msg" title={stash.message}>{stash.message}</span>
                                    <span className="age">{stashAge(stash.when_unix)}</span>
                                </div>
                                <div className="acts">
                                    <button type="button" onClick={() => applyStash(stash.index)}>Apply</button>
                                    <button type="button" onClick={() => popStash(stash.index)}>Pop</button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setBranchStash({ key: stashKey(stash), index: stash.index })
                                            setBranchName("stash-" + stash.index)
                                        }}
                                    >
                                        Branch
                                    </button>
                                    <button type="button" className="danger" onClick={() => dropStash(stash.index)}>Drop</button>
                                </div>
                                {branchStash?.key === stashKey(stash) && branchStash.index === stash.index ? (
                                    <div className="branch">
                                        <input
                                            aria-label={"Branch from stash " + stash.index}
                                            value={branchName}
                                            onChange={(event) => setBranchName(event.currentTarget.value)}
                                            onKeyDown={(event) => {
                                                event.stopPropagation()
                                                if (event.key === "Enter") {
                                                    stashToBranch(stash.index, branchName)
                                                    setBranchStash(null)
                                                    setBranchName("")
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                stashToBranch(stash.index, branchName)
                                                setBranchStash(null)
                                                setBranchName("")
                                            }}
                                        >
                                            Create
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setBranchStash(null)
                                                setBranchName("")
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ))
                    ) : (
                        <div className="yz2-stash-empty">No stashes</div>
                    )}
                </div>
            </div>
        </>
    )
}
