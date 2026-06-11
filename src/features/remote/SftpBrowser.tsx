import { Download, File, Folder, FolderOpen, Upload } from "lucide-react";
import { useRef, type Key } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { RemoteFileEntry, RemoteHostProfile } from "./remote-model";

type SftpBrowserProps = {
  host: RemoteHostProfile;
  path: string;
  entries: RemoteFileEntry[];
  onOpenSftp: (hostId: string) => void;
  onListDirectory: (hostId: string, path: string) => void;
  onDownloadFile: (path: string) => void;
  onUploadFile: (path: string) => void;
};

type VirtualRow = {
  index: number;
  key: Key;
  start: number;
};

export function SftpBrowser({
  host,
  path,
  entries,
  onOpenSftp,
  onListDirectory,
  onDownloadFile,
  onUploadFile,
}: SftpBrowserProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const rows: VirtualRow[] =
    virtualRows.length > 0
      ? virtualRows
      : entries.map((entry, index) => ({
          index,
          key: entry.path,
          start: index * 28,
        }));

  return (
    <section className="remote-sftp" aria-label="SFTP browser">
      <div className="section-label remote-sftp-label">
        <span className="mono">
          {host.username}@{host.name}:{path}
        </span>
      </div>
      <div className="remote-sftp-actions">
        <button
          type="button"
          className="btn sm"
          onClick={() => onOpenSftp(host.id)}
        >
          <FolderOpen aria-hidden="true" />
          Open
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => onUploadFile(path)}
        >
          <Upload aria-hidden="true" />
          Upload
        </button>
      </div>
      <div className="remote-sftp-list" ref={parentRef}>
        <div
          className="remote-sftp-spacer"
          style={{ height: rowVirtualizer.getTotalSize() || entries.length * 28 }}
        >
          {rows.map((row) => {
            const entry = entries[row.index];
            if (!entry) {
              return null;
            }

            const isDirectory = entry.kind === "Directory";
            const Icon = isDirectory ? Folder : File;

            return (
              <button
                type="button"
                className="remote-sftp-row"
                key={row.key}
                style={{ transform: `translateY(${row.start}px)` }}
                aria-label={
                  isDirectory
                    ? `Open directory ${entry.name}`
                    : `Download file ${entry.name}`
                }
                onClick={() => {
                  if (isDirectory) {
                    onListDirectory(host.id, entry.path);
                    return;
                  }

                  onDownloadFile(entry.path);
                }}
              >
                <Icon
                  aria-hidden="true"
                  className={isDirectory ? "ico-folder" : "ico-md"}
                />
                <span className="nm mono remote-sftp-name">
                  {entry.name}
                  {entry.link_target ? (
                    <span className="remote-link-target">
                      {" "}
                      -&gt; {entry.link_target}
                    </span>
                  ) : null}
                </span>
                <span className="meta">{formatBytes(entry.size)}</span>
                {!isDirectory ? (
                  <Download aria-hidden="true" className="remote-row-action" />
                ) : (
                  <span aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function formatBytes(size: number | null): string {
  if (size === null) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
