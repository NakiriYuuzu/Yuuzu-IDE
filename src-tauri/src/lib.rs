pub mod agent;
pub mod browser_preview;
mod commands;
pub mod database;
pub mod docs;
mod file_system;
mod file_watcher;
pub mod git;
pub mod lsp;
mod metrics;
mod pty;
pub mod remote;
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
            app.manage(lsp::LspState::new());
            app.manage(remote::RemoteState::new());
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
            commands::list_agent_sessions,
            commands::start_agent_session,
            commands::append_agent_transcript,
            commands::update_agent_approval,
            commands::export_agent_prompt,
            commands::list_context_packs,
            commands::create_context_pack,
            commands::delete_context_pack,
            commands::link_context_pack,
            commands::list_remote_hosts,
            commands::save_remote_host,
            commands::delete_remote_host,
            commands::list_database_profiles,
            commands::save_database_profile,
            commands::delete_database_profile,
            commands::inspect_database_schema,
            commands::execute_database_query,
            commands::list_database_query_history,
            commands::export_database_query_result,
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
            commands::lsp_server_status,
            commands::lsp_open_document,
            commands::lsp_close_document,
            commands::lsp_document_diagnostics,
            commands::lsp_workspace_diagnostics,
            commands::lsp_hover,
            commands::lsp_definition,
            commands::lsp_references,
            commands::lsp_completion,
            commands::lsp_code_actions,
            commands::lsp_symbols,
            commands::lsp_rename,
            commands::lsp_restart_server,
            commands::lsp_server_logs,
            commands::browser_validate_url,
            commands::browser_capture_preview,
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
