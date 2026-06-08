/* Yuuzu-IDE — editor-area scenes */

/* ---------------- Code editor ---------------- */
function CodeEditor({ file }) {
  const f = window.FILES[file];
  if (!f) return null;
  const lines = f.body.split('\n');
  const cur = 8; // pretend cursor line
  const changed = { 7: 'mod', 8: 'mod', 18: 'add' };
  return (
    <div className="group-content">
      <div className="breadcrumb">
        {f.path.split('/').map((p, i, arr) => (
          <React.Fragment key={i}>
            <span className="crumb">{p}</span>
            {i < arr.length - 1 && <Icon name="chevR" />}
          </React.Fragment>
        ))}
      </div>
      <div className="code">
        <div className="gutter">
          {lines.map((_, i) => (
            <div key={i} className={'ln' + (i === cur ? ' cur' : '') + (changed[i] ? ' ' + changed[i] : '')}>{i + 1}</div>
          ))}
        </div>
        <div className="codelines">
          {lines.map((ln, i) => (
            <div key={i} className={'cl' + (i === cur ? ' cur' : '')}>
              {window.tokenize(ln, f.lang).map((t, j) => <span key={j} className={'tok-' + t.cls}>{t.txt}</span>)}
              {i === cur && <span className="cursor" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Browser ---------------- */
function BrowserScene({ url }) {
  const u = url || 'localhost:3000';
  return (
    <div className="group-content">
      <div style={{ height: 42, flex: '0 0 42px', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: '1px solid var(--line)', background: 'var(--chrome)' }}>
        <button className="iconbtn"><Icon name="arrowL" /></button>
        <button className="iconbtn"><Icon name="arrowR" /></button>
        <button className="iconbtn"><Icon name="refresh" /></button>
        <button className="iconbtn"><Icon name="home" /></button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 11px', border: '1px solid var(--line)', borderRadius: 9999, background: 'var(--editor)' }}>
          <Icon name="lock" style={{ width: 13, height: 13, color: 'var(--yuzu)' }} />
          <span className="mono" style={{ fontSize: 12.5, color: 'var(--txt)' }}>{u}</span>
        </div>
        <button className="iconbtn"><Icon name="star" /></button>
        <button className="iconbtn"><Icon name="dots" /></button>
      </div>
      <div className="scene-scroll" style={{ background: '#fff' }}>
        <BrowserPage url={u} />
      </div>
    </div>
  );
}
function BrowserPage({ url }) {
  if (url.includes('/health')) {
    return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: '#1f2937', padding: 24, background: '#fff', minHeight: '100%' }}>
      <pre style={{ margin: 0 }}>{`{\n  "status": "ok",\n  "uptime": 8421.44\n}`}</pre>
    </div>;
  }
  // mock landing page (always light, it's a "website")
  return (
    <div style={{ minHeight: '100%', background: 'linear-gradient(180deg,#fbfdf6,#fff)', color: '#0f172a', fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 40px', borderBottom: '1px solid #eef2e6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 800, fontSize: 17 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg,#a8e23f,#74a818)', display: 'grid', placeItems: 'center', color: '#0a0e15', fontFamily: 'var(--font-mono)' }}>ゆ</span> yuuzu
        </div>
        <div style={{ display: 'flex', gap: 22, fontSize: 14, color: '#475569' }}><span>Docs</span><span>Pricing</span><span>Blog</span><span style={{ color: '#0f172a', fontWeight: 600 }}>Sign in</span></div>
      </div>
      <div style={{ padding: '70px 40px', textAlign: 'center', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5e8c14', background: '#eef6dc', border: '1px solid #c2dd8a', borderRadius: 9999, padding: '5px 12px', fontWeight: 600 }}>● dev server running on :3000</div>
        <h1 style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-0.03em', margin: '22px 0 14px', lineHeight: 1.05 }}>Everything you need,<br />one keystroke away.</h1>
        <p style={{ fontSize: 18, color: '#64748b', lineHeight: 1.6, margin: '0 0 28px' }}>The CLI-first workspace with editors, databases and remotes built in.</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <span style={{ background: '#0f172a', color: '#fff', padding: '12px 22px', borderRadius: 9, fontWeight: 600, fontSize: 15 }}>Get started</span>
          <span style={{ border: '1px solid #cbd5e1', padding: '12px 22px', borderRadius: 9, fontWeight: 600, fontSize: 15 }}>npx yuuzu</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, padding: '0 40px 60px', maxWidth: 900, margin: '0 auto' }}>
        {[['Editors', 'Split, multi-cursor, LSP'], ['Databases', 'SQLite · Postgres · MSSQL'], ['Remotes', 'SSH + SFTP, one click']].map(([t, d], i) => (
          <div key={i} style={{ border: '1px solid #eef2e6', borderRadius: 12, padding: 20, background: '#fff' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t}</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Database query + grid ---------------- */
function DbScene({ meta }) {
  const q = window.queryResult;
  const db = meta.db; const table = meta.table;
  return (
    <div className="group-content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, flex: '0 0 38px', padding: '0 12px', borderBottom: '1px solid var(--line)', background: 'var(--chrome)' }}>
        <Icon name="database" style={{ width: 15, height: 15, color: 'var(--yuzu)' }} />
        <span className="mono" style={{ fontSize: 12.5 }}>{db.name}</span>
        <span style={{ color: 'var(--txt-faint)' }}>/</span>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{table}</span>
        <span className="badge2 green" style={{ marginLeft: 6 }}><span className="d" />{db.kind}</span>
        <div style={{ flex: 1 }} />
        <button className="btn primary sm"><Icon name="play" /> Run <span className="mono" style={{ opacity: .7 }}>⌘↵</span></button>
        <button className="btn sm"><Icon name="download" /> Export</button>
      </div>
      <div style={{ flex: '0 0 auto', borderBottom: '1px solid var(--line)', background: 'var(--editor)' }}>
        <div className="code" style={{ maxHeight: 116 }}>
          <div className="gutter">{q.sql.split('\n').map((_, i) => <div className="ln" key={i}>{i + 1}</div>)}</div>
          <div className="codelines">{q.sql.split('\n').map((ln, i) => (
            <div className="cl" key={i}>{window.tokenize(ln, 'sql').map((t, j) => <span key={j} className={'tok-' + t.cls}>{t.txt}</span>)}</div>
          ))}</div>
        </div>
      </div>
      <div style={{ height: 30, flex: '0 0 30px', display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', borderBottom: '1px solid var(--line)', fontSize: 11.5, color: 'var(--txt-dim)', fontFamily: 'var(--font-mono)' }}>
        <span><b style={{ color: 'var(--yuzu)' }}>{q.rows.length}</b> rows</span>
        <span>· 14 ms</span>
        <span className="badge2"><Icon name="filter" style={{ width: 11, height: 11 }} /> No filter</span>
      </div>
      <div className="scene-scroll">
        <table className="dbgrid">
          <thead><tr><th className="rownum">#</th>{q.cols.map((cName, i) => <th key={i}>{cName}</th>)}</tr></thead>
          <tbody>
            {q.rows.map((row, i) => (
              <tr key={i}>
                <td className="rownum">{i + 1}</td>
                {row.map((cell, j) => <td key={j} className={j === 0 ? 'mono' : ''}>{j === 3 ? <span className="badge2 green"><span className="d" />{cell}</span> : cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Terminal / SSH ---------------- */
function TermView({ lines, prompt }) {
  return (
    <div className="scene-scroll" style={{ background: 'var(--editor)', padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.55 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: 'pre-wrap', color: l.t === 'good' ? 'var(--yuzu)' : l.t === 'in' ? 'var(--txt)' : 'var(--txt-dim)' }}>
          {l.t === 'in' && <span style={{ color: 'var(--yuzu)' }}>{prompt} </span>}{l.text}
        </div>
      ))}
      <div style={{ display: 'flex', color: 'var(--txt)' }}>
        <span style={{ color: 'var(--yuzu)' }}>{prompt}&nbsp;</span>
        <span className="cursor" style={{ height: 15 }} />
      </div>
    </div>
  );
}
function TerminalScene() {
  const local = [
    { t: 'in', text: 'npm run dev' },
    { t: 'out', text: '> yuuzu-api@0.4.2 dev' },
    { t: 'out', text: '> tsx watch src/server.ts' },
    { t: 'out', text: '' },
    { t: 'good', text: '✔ connected to postgres' },
    { t: 'good', text: '✔ yuuzu api listening on :3000' },
  ];
  return (
    <div className="group-content">
      <div className="term-tabs">
        <span className="tt active"><Icon name="terminal" style={{ width: 13, height: 13 }} /> zsh</span>
        <span className="tt">dev server</span>
        <span className="tt">edge-01</span>
        <div style={{ flex: 1 }} />
        <button className="iconbtn"><Icon name="plus" /></button>
        <button className="iconbtn"><Icon name="splitH" /></button>
        <button className="iconbtn"><Icon name="stop" /></button>
      </div>
      <TermView lines={local} prompt="~/dev/yuuzu-api ❯" />
    </div>
  );
}
function SshScene({ meta }) {
  const h = meta.host;
  return (
    <div className="group-content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, flex: '0 0 38px', padding: '0 12px', borderBottom: '1px solid var(--line)', background: 'var(--chrome)' }}>
        <Icon name="server" style={{ width: 15, height: 15, color: 'var(--yuzu)' }} />
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{h.user}@{h.host}</span>
        <span className="badge2 green"><span className="d" />SSH · connected</span>
        <div style={{ flex: 1 }} />
        <button className="btn sm"><Icon name="upload" /> SFTP</button>
        <button className="btn sm"><Icon name="key" /> Keys</button>
      </div>
      <TermView lines={window.termLines} prompt={`deploy@${h.name}:~$`} />
    </div>
  );
}

/* ---------------- Git graph ---------------- */
function GitGraphScene() {
  const g = window.gitGraph;
  return (
    <div className="group-content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, flex: '0 0 38px', padding: '0 12px', borderBottom: '1px solid var(--line)', background: 'var(--chrome)' }}>
        <Icon name="gitgraph" style={{ width: 15, height: 15, color: 'var(--yuzu)' }} />
        <span style={{ fontWeight: 600 }}>Commit Graph</span>
        <span className="badge2"><Icon name="branch" style={{ width: 11, height: 11 }} /> main</span>
        <div style={{ flex: 1 }} />
        <button className="btn sm"><Icon name="download" /> Fetch</button>
        <button className="btn sm"><Icon name="history" /> All branches</button>
      </div>
      <div className="scene-scroll">
        <table className="dbgrid gitgraph">
          <thead><tr><th style={{ width: 90 }}>Graph</th><th>Description</th><th style={{ width: 120 }}>Author</th><th style={{ width: 90 }}>When</th><th style={{ width: 90 }}>Commit</th></tr></thead>
          <tbody>
            {g.map((cmt, i) => (
              <tr key={i}>
                <td>
                  <svg width="80" height="36" style={{ display: 'block' }}>
                    <line x1="14" y1="-4" x2="14" y2="40" stroke="var(--yuzu)" strokeWidth="2" />
                    {cmt.lane === 1 && <line x1="34" y1="-4" x2="34" y2="40" stroke="#82aaff" strokeWidth="2" />}
                    {cmt.merge && <path d="M14 18 q 0 -14 20 -16" fill="none" stroke="#82aaff" strokeWidth="2" />}
                    <circle cx={cmt.lane === 1 ? 34 : 14} cy="18" r="5" fill="var(--editor)" stroke={cmt.lane === 1 ? '#82aaff' : 'var(--yuzu)'} strokeWidth="2.5" />
                  </svg>
                </td>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {cmt.refs.map((rf, k) => (
                      <span key={k} className="badge2" style={{ borderColor: rf.includes('HEAD') ? 'var(--yuzu-edge)' : 'var(--line)', color: rf.includes('HEAD') ? 'var(--yuzu)' : rf.startsWith('v') ? 'var(--c-num)' : 'var(--txt-dim)', background: rf.includes('HEAD') ? 'var(--yuzu-wash)' : 'transparent' }}>
                        <Icon name={rf.startsWith('v') ? 'star' : 'branch'} style={{ width: 10, height: 10 }} />{rf}
                      </span>
                    ))}
                    <span>{cmt.msg}</span>
                  </span>
                </td>
                <td style={{ color: 'var(--txt-dim)' }}>{cmt.author}</td>
                <td style={{ color: 'var(--txt-faint)' }} className="mono">{cmt.when} ago</td>
                <td className="mono" style={{ color: 'var(--c-num)' }}>{cmt.hash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Settings ---------------- */
function SettingsScene({ api }) {
  return (
    <div className="group-content">
      <div className="scene-scroll" style={{ padding: '28px 36px', maxWidth: 760 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Appearance</h2>
        <p style={{ color: 'var(--txt-dim)', margin: '0 0 24px', fontSize: 14 }}>Customize how Yuuzu looks on your machine.</p>
        <SettingRow title="Theme" desc="Switch between light and dark surfaces.">
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={'btn sm' + (api.theme === 'light' ? ' primary' : '')} onClick={() => api.setTheme('light')}><Icon name="sun" /> Light</button>
            <button className={'btn sm' + (api.theme === 'dark' ? ' primary' : '')} onClick={() => api.setTheme('dark')}><Icon name="moon" /> Dark</button>
          </div>
        </SettingRow>
        <SettingRow title="Accent color" desc="The yuzu-green highlight used across the UI.">
          <div style={{ display: 'flex', gap: 8 }}>
            {['#a8e23f', '#3b82f6', '#f59e0b', '#ef4444'].map(col => (
              <span key={col} onClick={() => api.setAccent(col)} style={{ width: 26, height: 26, borderRadius: 7, background: col, cursor: 'pointer', outline: api.accent === col ? '2px solid var(--txt)' : '2px solid transparent', outlineOffset: 2 }} />
            ))}
          </div>
        </SettingRow>
        <SettingRow title="Font family" desc="Editor uses a monospace; UI uses Inter.">
          <span className="badge2 mono">JetBrains Mono</span>
        </SettingRow>
        <SettingRow title="Font size" desc="Editor font size in pixels.">
          <span className="badge2 mono">13px</span>
        </SettingRow>
      </div>
    </div>
  );
}
function SettingRow({ title, desc, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '18px 0', borderTop: '1px solid var(--line)' }}>
      <div><div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div><div style={{ color: 'var(--txt-dim)', fontSize: 13, marginTop: 2 }}>{desc}</div></div>
      <div style={{ flex: '0 0 auto' }}>{children}</div>
    </div>
  );
}

window.Scenes = { CodeEditor, BrowserScene, DbScene, TerminalScene, SshScene, GitGraphScene, SettingsScene };
