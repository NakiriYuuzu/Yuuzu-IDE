mod commands;
mod metrics;
mod pty;
mod workspace;
mod workspace_scan;
mod workspace_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_workspaces,
            commands::add_workspace,
            commands::switch_workspace,
            commands::scan_workspace,
            commands::terminal_probe,
            commands::metric_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
