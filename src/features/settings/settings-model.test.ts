/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  createSettingsState,
  selectSettingsCategory,
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
});
