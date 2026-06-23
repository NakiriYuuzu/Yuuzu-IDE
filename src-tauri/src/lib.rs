pub mod agent;
mod background_process;
pub mod browser_preview;
mod clipboard;
mod commands;
pub mod database;
pub mod debug;
mod diagnostics;
pub mod docs;
pub mod extensions;
mod file_system;
mod file_watcher;
pub mod git;
pub mod git_log;
pub mod lsp;
mod metrics;
mod pty;
mod recovery;
pub mod remote;
mod search;
mod settings;
mod tasks;
mod terminal;
mod workspace;
mod workspace_scan;
mod workspace_store;

use tauri::Manager;

#[cfg(target_os = "macos")]
fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
            app.manage(commands::AppState::new(config_dir)?);
            app.manage(file_watcher::FileWatcherState::new());
            app.manage(tasks::TaskState::new());
            app.manage(terminal::TerminalState::new());
            app.manage(lsp::LspState::new());
            app.manage(remote::RemoteState::new());
            app.manage(debug::DebugState::new_with_event_sink(std::sync::Arc::new(
                debug::TauriDebugEventSink::new(app.handle().clone()),
            )));
            #[cfg(target_os = "macos")]
            show_main_window(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_settings,
            commands::save_settings,
            commands::import_keybindings,
            commands::list_workspaces,
            commands::add_workspace,
            commands::switch_workspace,
            commands::open_workspace_path,
            commands::remove_workspace,
            commands::pin_workspace,
            commands::save_unsaved_backup,
            commands::list_unsaved_backups,
            commands::discard_unsaved_backup,
            commands::append_diagnostic_event,
            commands::list_diagnostic_events,
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
            commands::debug_list_launch_configs,
            commands::debug_save_launch_config,
            commands::debug_delete_launch_config,
            commands::extension_statuses,
            commands::set_extension_enabled,
            commands::record_extension_performance,
            commands::debug_list_sessions,
            commands::debug_start_session,
            commands::debug_set_breakpoints,
            commands::debug_set_session_breakpoints,
            commands::debug_continue,
            commands::debug_step_over,
            commands::debug_pause,
            commands::debug_disconnect,
            commands::debug_stack_trace,
            commands::debug_scopes,
            commands::debug_variables,
            commands::debug_evaluate,
            commands::debug_session_logs,
            commands::connect_remote_host,
            commands::disconnect_remote_host,
            commands::list_ssh_terminal_sessions,
            commands::spawn_ssh_terminal,
            commands::write_ssh_terminal,
            commands::resize_ssh_terminal,
            commands::close_ssh_terminal,
            commands::run_remote_command,
            commands::list_sftp_directory,
            commands::download_sftp_file,
            commands::upload_sftp_file,
            commands::list_database_profiles,
            commands::save_database_profile,
            commands::delete_database_profile,
            commands::test_database_connection,
            commands::inspect_database_schema,
            commands::execute_database_query,
            commands::list_database_query_history,
            commands::export_database_query_result,
            commands::git_status,
            commands::git_diff_file,
            commands::git_diff_hunks,
            commands::git_log_page,
            commands::git_commit_detail,
            commands::git_commit_file_diff,
            commands::git_commit_file_worktree_diff,
            commands::git_cherry_pick,
            commands::git_revert_commit,
            commands::git_reset_to,
            commands::git_export_commit,
            commands::git_branches_full,
            commands::git_merge_branch,
            commands::git_branch_delete,
            commands::git_branch_rename,
            commands::git_stash_list,
            commands::git_stash_apply,
            commands::git_stash_pop,
            commands::git_stash_drop,
            commands::git_stash_branch,
            commands::git_conflict_file,
            commands::git_mark_resolved,
            commands::git_accept_conflict_side,
            commands::git_blame_file,
            commands::git_file_history,
            commands::git_stage_hunks,
            commands::git_unstage_hunks,
            commands::git_revert_hunk,
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
            commands::resize_terminal_session,
            commands::close_terminal_session,
            commands::list_workspace_tasks,
            commands::run_workspace_task,
            commands::stop_task_run,
            commands::list_task_runs,
            commands::lsp_server_status,
            commands::lsp_open_document,
            commands::lsp_ensure_document,
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
            commands::write_clipboard_text,
            commands::read_text_file,
            commands::write_text_file,
            commands::create_text_file,
            commands::create_directory,
            commands::rename_path,
            commands::delete_path
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main_window(app_handle);
        }
    });
}

#[cfg(test)]
mod background_process_contract_tests {
    #[test]
    fn windows_sensitive_background_spawns_use_central_helper() {
        let direct_spawn_patterns = [
            (
                "git.rs",
                include_str!("git.rs"),
                &[
                    "Command::new(\"git\")",
                    "std::process::Command::new(\"git\")",
                ][..],
            ),
            (
                "tasks.rs",
                include_str!("tasks.rs"),
                &["Command::new(spec.program)", "Command::new(\"taskkill\")"][..],
            ),
            (
                "lsp.rs",
                include_str!("lsp.rs"),
                &["Command::new(resolve_lsp_command_path_with_path"][..],
            ),
            (
                "debug.rs",
                include_str!("debug.rs"),
                &["Command::new(&program)"][..],
            ),
            (
                "clipboard.rs",
                include_str!("clipboard.rs"),
                &["Command::new(program)"][..],
            ),
        ];

        let mut violations = Vec::new();
        for (file, source, patterns) in direct_spawn_patterns {
            for pattern in patterns {
                if source.contains(pattern) {
                    violations.push(format!("{file} still contains {pattern}"));
                }
            }
        }

        assert!(violations.is_empty(), "{}", violations.join("\n"));
    }
}
