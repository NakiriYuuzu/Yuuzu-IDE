/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  createSettingsState,
  selectSettingsCategory,
  setKeybindingImportDraft,
  setKeybindingImportError,
  storeSettings,
  type AppSettings,
} from "./settings-model";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    schema_version: 2,
    density: "compact",
    color_theme: "dark",
    accent_color: "yuzu",
    update_channel: "manual",
    keybindings: [],
    ...overrides,
  };
}

describe("settings model", () => {
  test("stores settings and selects diagnostics category", () => {
    const state = selectSettingsCategory(
      storeSettings(createSettingsState(), settings()),
      "diagnostics",
    );

    expect(state.settings?.update_channel).toBe("manual");
    expect(state.activeCategory).toBe("diagnostics");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  test("stores scoped keybinding import error without overwriting global error", () => {
    const state = createSettingsState();

    expect(state.keybindingImportError).toBeNull();

    const withImportError = setKeybindingImportError(
      { ...state, error: "Settings failed" },
      "Import is available after migration",
    );

    expect(withImportError.keybindingImportError).toBe(
      "Import is available after migration",
    );
    expect(withImportError.error).toBe("Settings failed");

    const withDraft = setKeybindingImportDraft(withImportError, "[{}]");

    expect(withDraft.keybindingImportDraft).toBe("[{}]");
    expect(withDraft.keybindingImportError).toBeNull();
    expect(withDraft.error).toBe("Settings failed");
  });
});
