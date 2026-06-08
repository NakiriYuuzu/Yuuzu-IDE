mod commands;
mod metrics;
mod pty;
mod settings;
mod workspace;
mod workspace_scan;
mod workspace_store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
            app.manage(commands::AppState::new(config_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_settings,
            commands::save_settings,
            commands::list_workspaces,
            commands::add_workspace,
            commands::switch_workspace,
            commands::open_workspace_path,
            commands::remove_workspace,
            commands::pin_workspace,
            commands::scan_workspace,
            commands::terminal_probe,
            commands::metric_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
