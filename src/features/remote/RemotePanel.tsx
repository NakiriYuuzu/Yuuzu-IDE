import {
  CircleAlert,
  Play,
  Plus,
  RefreshCw,
  Server,
  SquareTerminal,
} from "lucide-react";

import "../../styles/ide.css";
import type { RemoteConnectionStatus, RemoteViewState } from "./remote-model";
import { RemoteCommandPanel } from "./RemoteCommandPanel";
import { SftpBrowser } from "./SftpBrowser";

type RemotePanelProps = {
  state: RemoteViewState;
  onModeChange: (mode: RemoteViewState["mode"]) => void;
  onSelectHost: (hostId: string) => void;
  onRefresh: () => void;
  onCreateHost: () => void;
  onConnectHost: (hostId: string) => void;
  onOpenSsh: (hostId: string) => void;
  onOpenSftp: (hostId: string) => void;
  onRunCommand: () => void;
  onCommandDraftChange: (value: string) => void;
  onListSftpDirectory: (hostId: string, path: string) => void;
  onDownloadFile: (path: string) => void;
  onUploadFile: (path: string) => void;
};

const remoteModes: Array<{
  mode: RemoteViewState["mode"];
  label: string;
}> = [
  { mode: "ssh", label: "SSH" },
  { mode: "sftp", label: "SFTP" },
  { mode: "commands", label: "Cmd" },
];

export function RemotePanel({
  state,
  onModeChange,
  onSelectHost,
  onRefresh,
  onCreateHost,
  onConnectHost,
  onOpenSsh,
  onOpenSftp,
  onRunCommand,
  onCommandDraftChange,
  onListSftpDirectory,
  onDownloadFile,
  onUploadFile,
}: RemotePanelProps) {
  const activeHost =
    state.hosts.find((host) => host.id === state.activeHostId) ?? null;
  const activePath = activeHost
    ? (state.sftpPathByHostId[activeHost.id] ??
      activeHost.default_remote_path ??
      "/")
    : "/";
  const sftpEntries = activeHost
    ? (state.sftpEntriesByHostPath[`${activeHost.id}:${activePath}`] ?? [])
    : [];

  return (
    <div className="remote-panel">
      <div className="panel-head">
        <span className="panel-title">Remote</span>
        <div className="panel-acts">
          <button
            type="button"
            className="iconbtn"
            title="New host"
            aria-label="New host"
            onClick={onCreateHost}
          >
            <Plus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="iconbtn"
            title="Refresh remote hosts"
            aria-label="Refresh remote hosts"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="panel-body remote-panel-body">
        <div className="remote-segmented" aria-label="Remote mode">
          {remoteModes.map((item) => (
            <button
              type="button"
              key={item.mode}
              className={`remote-segment${state.mode === item.mode ? " active" : ""}`}
              aria-pressed={state.mode === item.mode}
              onClick={() => onModeChange(item.mode)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {state.error ? (
          <div className="terminal-inline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            {state.error}
          </div>
        ) : null}

        {state.mode === "ssh" ? (
          <RemoteHostList
            state={state}
            onSelectHost={onSelectHost}
            onConnectHost={onConnectHost}
            onOpenSsh={onOpenSsh}
          />
        ) : null}

        {state.mode === "sftp" && activeHost ? (
          <SftpBrowser
            host={activeHost}
            path={activePath}
            entries={sftpEntries}
            onOpenSftp={onOpenSftp}
            onListDirectory={onListSftpDirectory}
            onDownloadFile={onDownloadFile}
            onUploadFile={onUploadFile}
          />
        ) : null}

        {state.mode === "sftp" && !activeHost ? <NoRemoteHosts /> : null}

        {state.mode === "commands" ? (
          <RemoteCommandPanel
            state={state}
            activeHost={activeHost}
            onDraftChange={onCommandDraftChange}
            onRunCommand={onRunCommand}
          />
        ) : null}

        {state.transfer ? (
          <div className="remote-transfer mono">
            {state.transfer.bytes} bytes · {state.transfer.remote_path}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type RemoteHostListProps = {
  state: RemoteViewState;
  onSelectHost: (hostId: string) => void;
  onConnectHost: (hostId: string) => void;
  onOpenSsh: (hostId: string) => void;
};

function RemoteHostList({
  state,
  onSelectHost,
  onConnectHost,
  onOpenSsh,
}: RemoteHostListProps) {
  if (state.hosts.length === 0) {
    return <NoRemoteHosts />;
  }

  return (
    <section className="remote-hosts" aria-label="SSH hosts">
      <div className="section-label">
        <span>Hosts</span>
        <span>{state.hosts.length}</span>
      </div>
      <div className="remote-host-list">
        {state.hosts.map((host) => {
          const health = state.connectionByHostId[host.id];
          const status = health?.status ?? "Disconnected";
          const active = host.id === state.activeHostId;

          return (
            <div
              className={`remote-host-row${active ? " active" : ""}`}
              key={host.id}
            >
              <button
                type="button"
                className="remote-host-select"
                aria-label={`Select ${host.name}`}
                onClick={() => onSelectHost(host.id)}
              >
                <Server
                  aria-hidden="true"
                  className={
                    status === "Connected" ? "remote-connected" : undefined
                  }
                />
                <span className="remote-host-copy">
                  <span className="remote-host-name">{host.name}</span>
                  <span className="mono remote-host-meta">
                    {host.username}@{host.host}
                  </span>
                  {health?.status === "Failed" && health.message ? (
                    <span className="remote-health mono">
                      {health.message}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`remote-dot ${statusClassName(status)}`}
                  title={status}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                className="iconbtn remote-host-action"
                title={`Connect ${host.name}`}
                aria-label={`Connect ${host.name}`}
                disabled={state.loading}
                onClick={() => onConnectHost(host.id)}
              >
                <Play aria-hidden="true" />
              </button>
              <button
                type="button"
                className="iconbtn remote-host-action"
                title={`Open SSH for ${host.name}`}
                aria-label={`Open SSH for ${host.name}`}
                onClick={() => onOpenSsh(host.id)}
              >
                <SquareTerminal aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NoRemoteHosts() {
  return (
    <div className="panel-empty remote-empty">
      <span>No remote hosts</span>
    </div>
  );
}

function statusClassName(status: RemoteConnectionStatus): string {
  return status.toLowerCase();
}
