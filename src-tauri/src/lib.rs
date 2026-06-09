mod commands;
pub mod docs;
mod file_system;
mod file_watcher;
pub mod git;
mod metrics;
mod pty;
mod search;
mod settings;
mod tasks;
mod terminal;
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
            app.manage(file_watcher::FileWatcherState::new());
            app.manage(tasks::TaskState::new());
            app.manage(terminal::TerminalState::new());
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
            commands::scan_directory,
            commands::search_workspace,
            commands::docs_index,
            commands::docs_preview,
            commands::docs_search,
            commands::git_status,
            commands::git_diff_file,
            commands::git_stage_paths,
            commands::git_unstage_paths,
            commands::git_discard_paths,
            commands::git_commit,
            commands::git_stash,
            commands::git_list_branches,
            commands::git_create_branch,
            commands::git_checkout_branch,
            commands::git_fetch,
            commands::git_pull,
            commands::git_push,
            commands::git_commit_graph,
            commands::git_reset_hard,
            commands::git_rebase_onto,
            commands::watch_workspace,
            commands::unwatch_workspace,
            commands::terminal_probe,
            commands::list_terminal_sessions,
            commands::spawn_terminal_session,
            commands::write_terminal_session,
            commands::close_terminal_session,
            commands::list_workspace_tasks,
            commands::run_workspace_task,
            commands::stop_task_run,
            commands::list_task_runs,
            commands::metric_snapshot,
            commands::read_text_file,
            commands::write_text_file,
            commands::create_text_file,
            commands::rename_path,
            commands::delete_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
