import { useEffect, useState } from "react"

import type { GitBranchFull } from "../features/git/git-model"
import { useV2Store } from "./v2-store"

function branchSort(a: GitBranchFull, b: GitBranchFull): number {
    if (a.current !== b.current) return a.current ? -1 : 1
    if (a.remote !== b.remote) return a.remote ? 1 : -1
    return a.name.localeCompare(b.name)
}

function checkoutTarget(branch: GitBranchFull): string {
    if (!branch.remote) return branch.name
    const slash = branch.name.indexOf("/")
    return slash >= 0 ? branch.name.slice(slash + 1) : branch.name
}

export function BranchPopup() {
    const open = useV2Store((s) => !!s.ui[s.active]?.branchPopupOpen)
    const meta = useV2Store((s) => s.meta[s.active])
    const git = useV2Store((s) => s.ui[s.active]?.git)
    const closeBranchPopup = useV2Store((s) => s.closeBranchPopup)
    const createBranch = useV2Store((s) => s.createBranch)
    const checkoutBranch = useV2Store((s) => s.checkoutBranch)
    const mergeBranch = useV2Store((s) => s.mergeBranch)
    const deleteBranch = useV2Store((s) => s.deleteBranch)
    const renameBranch = useV2Store((s) => s.renameBranch)
    const [createName, setCreateName] = useState("")
    const [renameFrom, setRenameFrom] = useState<string | null>(null)
    const [renameTo, setRenameTo] = useState("")

    useEffect(() => {
        if (!open) {
            setCreateName("")
            setRenameFrom(null)
            setRenameTo("")
        }
    }, [open])

    if (!open || !git || !meta) return null

    const current = git.branch || meta.branch
    const branches = [...git.branchesFull].sort(branchSort)

    return (
        <>
            <div className="yz2-branch-popback" onClick={closeBranchPopup} />
            <div className="yz2-branch-popup" role="dialog" aria-label="Branches">
                <div className="yz2-branch-head">
                    <span>Branches</span>
                    <button type="button" onClick={closeBranchPopup}>Close</button>
                </div>
                <div className="yz2-branch-current" title={current}>Current: {current || "detached"}</div>
                <div className="yz2-branch-list">
                    {branches.length ? (
                        branches.map((branch) => {
                            const target = checkoutTarget(branch)
                            const canCheckout = !branch.current && target !== current
                            const canMerge = !branch.current
                            const canMutateLocal = !branch.current && !branch.remote
                            const renaming = renameFrom === branch.name
                            return (
                                <div key={(branch.remote ? "r:" : "l:") + branch.name} className="yz2-branch-row">
                                    <div className="main">
                                        <span className={"dot" + (branch.current ? " is-current" : "")} />
                                        <span className="name" title={branch.name}>{branch.name}</span>
                                        {branch.remote ? <span className="chip">remote</span> : null}
                                        {branch.upstream ? <span className="chip">{branch.upstream}</span> : null}
                                        {branch.ahead || branch.behind ? (
                                            <span className="chip">{branch.ahead} up {branch.behind} down</span>
                                        ) : null}
                                    </div>
                                    <div className="acts">
                                        <button type="button" disabled={!canCheckout} onClick={() => checkoutBranch(target)}>
                                            Checkout
                                        </button>
                                        <button type="button" disabled={!canMerge} onClick={() => mergeBranch(branch.name)}>
                                            Merge
                                        </button>
                                        <button
                                            type="button"
                                            disabled={!canMutateLocal}
                                            onClick={() => {
                                                setRenameFrom(branch.name)
                                                setRenameTo(branch.name)
                                            }}
                                        >
                                            Rename
                                        </button>
                                        <button type="button" className="danger" disabled={!canMutateLocal} onClick={() => deleteBranch(branch.name)}>
                                            Delete
                                        </button>
                                    </div>
                                    {renaming ? (
                                        <div className="rename">
                                            <input
                                                aria-label={"New name for " + branch.name}
                                                value={renameTo}
                                                onChange={(event) => setRenameTo(event.currentTarget.value)}
                                                onKeyDown={(event) => {
                                                    event.stopPropagation()
                                                    if (event.key === "Enter") {
                                                        renameBranch(branch.name, renameTo)
                                                        setRenameFrom(null)
                                                        setRenameTo("")
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    renameBranch(branch.name, renameTo)
                                                    setRenameFrom(null)
                                                    setRenameTo("")
                                                }}
                                            >
                                                Save
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setRenameFrom(null)
                                                    setRenameTo("")
                                                }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            )
                        })
                    ) : (
                        <div className="yz2-branch-empty">No branches loaded</div>
                    )}
                </div>
                <div className="yz2-branch-create">
                    <input
                        aria-label="New branch name"
                        placeholder="new-branch"
                        value={createName}
                        onChange={(event) => setCreateName(event.currentTarget.value)}
                        onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.key === "Enter") {
                                createBranch(createName)
                                setCreateName("")
                            }
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => {
                            createBranch(createName)
                            setCreateName("")
                        }}
                    >
                        Create
                    </button>
                </div>
            </div>
        </>
    )
}
