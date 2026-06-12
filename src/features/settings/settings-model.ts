export type KeybindingSetting = {
  command_id: string;
  key: string;
  source: string;
};

export type AppSettings = {
  schema_version: number;
  density: string;
  color_theme: string;
  accent_color: string;
  update_channel: string;
  keybindings: KeybindingSetting[];
};

export type AppSettingsInput = Partial<AppSettings> & Record<string, unknown>;

export type SettingsCategory =
  | "recovery"
  | "performance"
  | "diagnostics"
  | "keybindings"
  | "updates"
  | "personal-setup";

export type SettingsViewState = {
  settings: AppSettings | null;
  activeCategory: SettingsCategory;
  keybindingImportDraft: string;
  keybindingImportError: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

export function normalizeSettings(settings: AppSettingsInput): AppSettings {
  return {
    schema_version: 2,
    density:
      typeof settings.density === "string" ? settings.density : "compact",
    color_theme:
      typeof settings.color_theme === "string" ? settings.color_theme : "dark",
    accent_color:
      typeof settings.accent_color === "string" ? settings.accent_color : "yuzu",
    update_channel:
      typeof settings.update_channel === "string"
        ? settings.update_channel
        : "manual",
    keybindings: Array.isArray(settings.keybindings)
      ? settings.keybindings.map((rawKeybinding) => {
          const keybinding = rawKeybinding as Record<string, unknown>;
          return {
            command_id: String(
              keybinding.command_id ?? keybinding.command ?? "",
            ),
            key: String(keybinding.key ?? ""),
            source:
              typeof keybinding.source === "string"
                ? keybinding.source
                : "custom",
          };
        })
      : [],
  };
}

export function createSettingsState(): SettingsViewState {
  return {
    settings: null,
    activeCategory: "recovery",
    keybindingImportDraft: "",
    keybindingImportError: null,
    loading: false,
    saving: false,
    error: null,
  };
}

export function storeSettings(
  state: SettingsViewState,
  settings: AppSettingsInput,
): SettingsViewState {
  return {
    ...state,
    settings: normalizeSettings(settings),
    loading: false,
    saving: false,
    error: null,
  };
}

export function selectSettingsCategory(
  state: SettingsViewState,
  activeCategory: SettingsCategory,
): SettingsViewState {
  return {
    ...state,
    activeCategory,
  };
}

export function setKeybindingImportDraft(
  state: SettingsViewState,
  keybindingImportDraft: string,
): SettingsViewState {
  return {
    ...state,
    keybindingImportDraft,
    keybindingImportError: null,
  };
}

export function setKeybindingImportError(
  state: SettingsViewState,
  keybindingImportError: string | null,
): SettingsViewState {
  return {
    ...state,
    keybindingImportError,
  };
}

export function setSettingsError(
  state: SettingsViewState,
  error: string | null,
): SettingsViewState {
  return {
    ...state,
    loading: false,
    saving: false,
    error,
  };
}
