import { settingDefault, type Tab } from "../v2-model"
import { useV2Store } from "../v2-store"
import { CodeMirrorEditorSurface } from "./CodeMirrorEditorSurface"
import { TextareaEditorSurface } from "./TextareaEditorSurface"

export function EditorHost({ tab }: { tab: Tab }) {
    const engine = useV2Store((s) => s.stVals.editorEngine ?? settingDefault("editorEngine"))
    if (engine === "textarea") return <TextareaEditorSurface tab={tab} />
    return <CodeMirrorEditorSurface tab={tab} />
}
