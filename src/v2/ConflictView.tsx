import type { Tab } from "./v2-model"
import { useV2Store } from "./v2-store"

function Lines({ lines }: { lines: string[] }) {
    return (
        <pre className="yz2-conflict-code">
            {lines.join("\n") || " "}
        </pre>
    )
}

export function ConflictView({ tab }: { tab: Tab }) {
    const choices = useV2Store((s) => s.ui[s.active].git.conflictChoices)
    const chooseConflictBlock = useV2Store((s) => s.chooseConflictBlock)
    const acceptConflictSide = useV2Store((s) => s.acceptConflictSide)
    const markResolved = useV2Store((s) => s.markResolved)
    const conflict = tab.conflict
    const path = tab.path ?? conflict?.path ?? ""
    const choiceFor = (blockIndex: number) => choices[path + ":" + blockIndex] ?? choices[blockIndex]

    if (tab.loading || !conflict) {
        return (
            <div className="yz2-view">
                <div className="yz2-ed-loading" style={{ flex: 1 }}>Loading conflict…</div>
            </div>
        )
    }

    return (
        <div className="yz2-view yz2-conflict">
            <div className="yz2-conflict-head">
                <div>
                    <div className="yz2-conflict-title">Conflict</div>
                    <div className="yz2-conflict-path">{path}</div>
                </div>
                <span className="yz2-spacer" />
                <button type="button" className="yz2-btn-ghost" onClick={() => acceptConflictSide(path, "ours")}>
                    Accept all ours
                </button>
                <button type="button" className="yz2-btn-ghost" onClick={() => acceptConflictSide(path, "theirs")}>
                    Accept all theirs
                </button>
                <button type="button" className="yz2-btn-accent" onClick={() => markResolved(path)}>
                    Mark resolved
                </button>
            </div>
            {conflict.truncated ? (
                <div className="yz2-panel-note" style={{ margin: "8px 12px" }}>
                    Conflict payload was truncated.
                </div>
            ) : null}
            <div className="yz2-conflict-grid">
                <div className="yz2-conflict-col ours">
                    <div className="yz2-conflict-colhead">OURS</div>
                    {conflict.blocks.map((block, index) => (
                        <section key={"ours-" + block.start_line + "-" + index} className="yz2-conflict-block">
                            <Lines lines={block.ours} />
                            <button type="button" className={choiceFor(index) === "ours" ? "is-on" : ""} onClick={() => chooseConflictBlock(index, "ours")}>
                                Use ours
                            </button>
                        </section>
                    ))}
                </div>
                <div className="yz2-conflict-col base">
                    <div className="yz2-conflict-colhead">BASE</div>
                    {conflict.blocks.map((block, index) => (
                        <section key={"base-" + block.start_line + "-" + index} className="yz2-conflict-block">
                            <Lines lines={conflict.base ? conflict.base.split("\n") : ["No base version"]} />
                            <div className="yz2-conflict-choice">choice: {choiceFor(index) ?? "unresolved"}</div>
                            <button type="button" disabled>
                                Per-block write pending
                            </button>
                        </section>
                    ))}
                </div>
                <div className="yz2-conflict-col theirs">
                    <div className="yz2-conflict-colhead">THEIRS</div>
                    {conflict.blocks.map((block, index) => (
                        <section key={"theirs-" + block.start_line + "-" + index} className="yz2-conflict-block">
                            <Lines lines={block.theirs} />
                            <button type="button" className={choiceFor(index) === "theirs" ? "is-on" : ""} onClick={() => chooseConflictBlock(index, "theirs")}>
                                Use theirs
                            </button>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    )
}
