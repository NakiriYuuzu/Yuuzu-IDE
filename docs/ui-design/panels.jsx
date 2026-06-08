/* Yuuzu-IDE — left content panels */
const { useState } = React;

function PanelHead({ title, children }) {
  return (
    <div className="panel-head">
      <span className="panel-title">{title}</span>
      <div className="panel-acts">{children}</div>
    </div>
  );
}
function Act({ icon, title, onClick }) {
  return <button className="iconbtn" title={title} onClick={onClick}><Icon name={icon} /></button>;
}

/* ---------------- Explorer ---------------- */
function TreeNode({ node, depth, api }) {
  const [open, setOpen] = useState(!!node.open);
  const pad = { paddingLeft: 8 + depth * 13 };
  if (node.type === 'folder') {
    return (
      <div>
        <div className="row" style={pad} onClick={() => setOpen(o => !o)}>
          <span className="tw"><Icon name={open ? 'chevD' : 'chevR'} /></span>
          <Icon name={open ? 'folderOpen' : 'folder'} className="ico-folder" />
          <span className="nm">{node.name}</span>
        </div>
        {open && node.children.map((ch, i) => <TreeNode key={i} node={ch} depth={depth + 1} api={api} />)}
      </div>
    );
  }
  const active = api.isActiveFile && api.isActiveFile(node.file);
  return (
    <div className={'row' + (active ? ' sel' : '')} style={pad}
         onClick={() => node.file && api.openFile(node.file)}>
      <span className="tw" />
      <Icon name={node.icon === 'db' ? 'database' : node.icon === 'json' ? 'file' : node.icon === 'ts' ? 'file' : node.icon === 'html' ? 'file' : node.icon === 'css' ? 'file' : node.icon === 'md' ? 'file' : 'file'} className={node.cls} />
      <span className="nm" style={{ color: node.file ? '' : 'var(--txt-dim)' }}>{node.name}</span>
      {node.git && <span className={'meta git-' + node.git}>{node.git}</span>}
    </div>
  );
}
function ExplorerPanel({ api }) {
  const proj = api.activeProject;
  return (
    <>
      <PanelHead title="Explorer">
        <Act icon="folderPlus" title="New folder" />
        <Act icon="plus" title="New file" />
        <Act icon="refresh" title="Refresh" />
        <Act icon="dots" title="More" />
      </PanelHead>
      <div className="panel-body">
        <div className="section-label">
          <span>{proj.name}</span><Icon name="chevD" style={{ width: 12, height: 12 }} />
        </div>
        {window.tree.map((n, i) => <TreeNode key={i} node={n} depth={0} api={api} />)}
        <div className="section-label" style={{ marginTop: 6 }}>
          <span>Outline</span>
        </div>
        {['main()', 'app', 'usersRouter'].map((s, i) => (
          <div className="row" key={i} style={{ paddingLeft: 12 }}>
            <Icon name="zap" style={{ color: 'var(--c-fn)' }} /><span className="nm mono" style={{ fontSize: 12 }}>{s}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Search ---------------- */
function SearchPanel({ api }) {
  const [q, setQ] = useState('query');
  const total = window.searchResults.reduce((a, r) => a + r.hits.length, 0);
  return (
    <>
      <PanelHead title="Search"><Act icon="refresh" title="Refresh" /><Act icon="dots" title="More" /></PanelHead>
      <div className="panel-body">
        <div style={{ padding: '10px 10px 4px' }}>
          <div style={{ position: 'relative' }}>
            <input className="input2 mono" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" style={{ paddingLeft: 28 }} />
            <Icon name="search" style={{ position: 'absolute', left: 8, top: 8, width: 14, height: 14, color: 'var(--txt-faint)' }} />
          </div>
          <div style={{ position: 'relative', marginTop: 6 }}>
            <input className="input2 mono" placeholder="Replace" style={{ paddingLeft: 28 }} />
            <Icon name="history" style={{ position: 'absolute', left: 8, top: 8, width: 14, height: 14, color: 'var(--txt-faint)' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <span className="badge2">Aa</span><span className="badge2">ab|</span>
            <span className="badge2">.*</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--txt-faint)' }} className="mono">{total} in 3 files</span>
          </div>
        </div>
        {window.searchResults.map((r, i) => (
          <div key={i}>
            <div className="row" style={{ height: 26, fontWeight: 600 }}>
              <span className="tw"><Icon name="chevD" /></span>
              <Icon name="file" className={r.cls} />
              <span className="nm mono" style={{ fontSize: 12 }}>{r.file.split('/').pop()}</span>
              <span className="meta" style={{ background: 'var(--active)', borderRadius: 8, padding: '0 6px', color: 'var(--txt-dim)' }}>{r.hits.length}</span>
            </div>
            {r.hits.map((h, j) => (
              <div className="row" key={j} style={{ paddingLeft: 30, color: 'var(--txt-dim)' }}>
                <span className="nm mono" style={{ fontSize: 12 }}>
                  {h.pre}<mark style={{ background: 'var(--yuzu-wash)', color: 'var(--yuzu)', borderRadius: 2, padding: '0 1px' }}>{h.m}</mark>{h.post}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Database ---------------- */
function dbDot(status) { return status === 'connected' ? 'var(--yuzu)' : 'var(--txt-faint)'; }
function DatabasePanel({ api }) {
  const [open, setOpen] = useState({ local: true, prod: false, legacy: false });
  return (
    <>
      <PanelHead title="Databases"><Act icon="plug" title="New connection" /><Act icon="refresh" title="Refresh" /></PanelHead>
      <div className="panel-body">
        {window.databases.map(db => (
          <div key={db.id}>
            <div className="row" style={{ height: 30 }} onClick={() => setOpen(o => ({ ...o, [db.id]: !o[db.id] }))}>
              <span className="tw"><Icon name={open[db.id] ? 'chevD' : 'chevR'} /></span>
              <Icon name="database" className="ico-db" />
              <div className="nm" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{db.name}</span>
                <span style={{ fontSize: 10.5, color: 'var(--txt-faint)' }} className="mono">{db.kind}</span>
              </div>
              <span className="dot" style={{ background: dbDot(db.status), boxShadow: db.status === 'connected' ? '0 0 0 2px var(--yuzu-wash)' : 'none' }} />
            </div>
            {open[db.id] && (
              <>
                <div className="row" style={{ paddingLeft: 34, color: 'var(--txt-dim)', height: 22 }}>
                  <Icon name="folder" className="ico-folder" style={{ width: 13, height: 13 }} /><span className="nm" style={{ fontSize: 12 }}>Tables</span>
                </div>
                {db.tables.map(([t, n], i) => (
                  <div className="row" key={i} style={{ paddingLeft: 50, height: 23 }} onClick={() => api.openDb(db, t)}>
                    <Icon name="table" style={{ width: 13, height: 13, color: 'var(--txt-faint)' }} />
                    <span className="nm mono" style={{ fontSize: 12 }}>{t}</span>
                    <span className="meta">{n.toLocaleString()}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Remote (SSH + SFTP) ---------------- */
function RemotePanel({ api }) {
  const [tab, setTab] = useState('hosts');
  return (
    <>
      <PanelHead title="Remote"><Act icon="plus" title="New host" /><Act icon="refresh" title="Refresh" /></PanelHead>
      <div style={{ display: 'flex', gap: 2, padding: '8px 10px 4px' }}>
        {[['hosts', 'SSH'], ['sftp', 'SFTP']].map(([k, lbl]) => (
          <button key={k} className={'btn sm' + (tab === k ? ' primary' : ' ghost')} onClick={() => setTab(k)} style={{ flex: 1, justifyContent: 'center' }}>{lbl}</button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'hosts' && window.sshHosts.map(h => (
          <div className="row" key={h.id} style={{ height: 38 }} onClick={() => api.openSsh(h)}>
            <Icon name="server" style={{ color: h.status === 'connected' ? 'var(--yuzu)' : 'var(--txt-dim)' }} />
            <div className="nm" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
              <span style={{ fontWeight: 600 }}>{h.name}</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--txt-faint)' }}>{h.user}@{h.host}</span>
            </div>
            <span className="dot" style={{ background: dbDot(h.status) }} />
          </div>
        ))}
        {tab === 'sftp' && (
          <>
            <div className="section-label"><span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>deploy@edge-01:/var/www</span></div>
            {window.sftpFiles.map((f, i) => (
              <div className="row" key={i} style={{ height: 24 }}>
                <Icon name={f.dir ? 'folder' : 'file'} className={f.dir ? 'ico-folder' : 'ico-md'} />
                <span className="nm mono" style={{ fontSize: 12, color: f.link ? 'var(--yuzu)' : '' }}>{f.name}{f.link && <span style={{ color: 'var(--txt-faint)' }}> {f.link}</span>}</span>
                <span className="meta">{f.size}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

/* ---------------- Git (source control) ---------------- */
function GitRow({ f }) {
  return (
    <div className="row" style={{ height: 24 }}>
      <Icon name="file" className="ico-ts" style={{ width: 14, height: 14 }} />
      <span className="nm mono" style={{ fontSize: 12 }}>{f.name.split('/').pop()}</span>
      <span className="meta" style={{ color: 'var(--txt-faint)' }}>{f.name.split('/').slice(0, -1).join('/')}</span>
      <span className={'git-' + f.git} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, width: 16, textAlign: 'center', marginLeft: 6 }}>{f.git}</span>
    </div>
  );
}
function GitPanel({ api }) {
  return (
    <>
      <PanelHead title="Source Control">
        <Act icon="check" title="Commit" /><Act icon="refresh" title="Refresh" /><Act icon="gitgraph" title="View graph" onClick={api.openGitGraph} />
      </PanelHead>
      <div className="panel-body">
        <div style={{ padding: '10px 10px 6px' }}>
          <textarea className="input2" rows="2" placeholder="Message (⌘Enter to commit on main)" style={{ height: 'auto', padding: 8, resize: 'none', fontFamily: 'var(--font-sans)' }} defaultValue="feat: paginate users endpoint"></textarea>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}>
            <Icon name="check" /> Commit &amp; Push <span className="mono" style={{ opacity: .7 }}>main</span>
          </button>
        </div>
        <div className="section-label"><span>Staged Changes</span><span className="meta" style={{ background: 'var(--active)', borderRadius: 8, padding: '0 6px' }}>{window.gitStaged.length}</span></div>
        {window.gitStaged.map((f, i) => <GitRow key={i} f={f} />)}
        <div className="section-label"><span>Changes</span><span className="meta" style={{ background: 'var(--active)', borderRadius: 8, padding: '0 6px' }}>{window.gitChanges.length}</span></div>
        {window.gitChanges.map((f, i) => <GitRow key={i} f={f} />)}
      </div>
    </>
  );
}

/* ---------------- Browser panel ---------------- */
function BrowserPanel({ api }) {
  const items = [['localhost:3000', 'home'], ['localhost:3000/health', 'zap'], ['yuuzu.dev/docs', 'star'], ['github.com/yuuzu', 'git']];
  return (
    <>
      <PanelHead title="Browser"><Act icon="plus" title="New tab" onClick={() => api.openBrowser('localhost:3000')} /></PanelHead>
      <div className="panel-body">
        <div className="section-label"><span>Bookmarks</span></div>
        {items.map(([u, ic], i) => (
          <div className="row" key={i} style={{ height: 28 }} onClick={() => api.openBrowser(u)}>
            <Icon name={ic} style={{ color: 'var(--txt-dim)' }} /><span className="nm mono" style={{ fontSize: 12 }}>{u}</span>
          </div>
        ))}
        <div className="section-label" style={{ marginTop: 6 }}><span>History</span></div>
        {['localhost:3000/api/users', 'localhost:3000/health'].map((u, i) => (
          <div className="row" key={i} style={{ height: 26, color: 'var(--txt-dim)' }} onClick={() => api.openBrowser(u)}>
            <Icon name="history" style={{ width: 13, height: 13, color: 'var(--txt-faint)' }} /><span className="nm mono" style={{ fontSize: 11.5 }}>{u}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Terminal panel ---------------- */
function TerminalPanel({ api }) {
  const sessions = [['zsh', '~/dev/yuuzu-api', true], ['dev server', 'npm run dev', false], ['edge-01', 'ssh deploy@…', false]];
  return (
    <>
      <PanelHead title="Terminal"><Act icon="plus" title="New terminal" onClick={() => api.openTerminal()} /></PanelHead>
      <div className="panel-body">
        <div className="section-label"><span>Sessions</span></div>
        {sessions.map(([n, sub, on], i) => (
          <div className={'row' + (on ? ' sel' : '')} key={i} style={{ height: 34 }} onClick={() => api.openTerminal(n)}>
            <Icon name="terminal" style={{ color: on ? 'var(--yuzu)' : 'var(--txt-dim)' }} />
            <div className="nm" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
              <span style={{ fontWeight: 600, fontSize: 12.5 }}>{n}</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--txt-faint)' }}>{sub}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Settings panel ---------------- */
function SettingsPanel({ api }) {
  const cats = [['Appearance', 'sun'], ['Editor', 'file'], ['Terminal', 'terminal'], ['Database', 'database'], ['Remotes', 'server'], ['Keybindings', 'cmd'], ['Extensions', 'zap']];
  return (
    <>
      <PanelHead title="Settings" />
      <div className="panel-body">
        {cats.map(([n, ic], i) => (
          <div className={'row' + (i === 0 ? ' sel' : '')} key={i} style={{ height: 30 }} onClick={() => api.openSettings()}>
            <Icon name={ic} style={{ color: 'var(--txt-dim)' }} /><span className="nm">{n}</span>
          </div>
        ))}
      </div>
    </>
  );
}

window.Panels = { ExplorerPanel, SearchPanel, DatabasePanel, RemotePanel, GitPanel, BrowserPanel, TerminalPanel, SettingsPanel };
