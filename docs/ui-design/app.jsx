/* Yuuzu-IDE — app shell */
const { useState, useEffect, useRef, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "#a8e23f",
  "density": "regular",
  "codeSize": 13,
  "defaultScene": "editor",
  "sidebarWidth": 264
}/*EDITMODE-END*/;

const ACCENTS = [
  { v: '#a8e23f', n: 'Yuzu' },
  { v: '#4ade80', n: 'Green' },
  { v: '#38bdf8', n: 'Blue' },
  { v: '#fb923c', n: 'Orange' },
  { v: '#c084fc', n: 'Violet' },
  { v: '#f472b6', n: 'Pink' },
];
const SCENES = [
  { v: 'editor', n: 'Editor' },
  { v: 'db', n: 'Database' },
  { v: 'browser', n: 'Browser' },
  { v: 'ssh', n: 'SSH' },
];

/* tab factory */
let TID = 1;
function mkTab(kind, key, extra) {
  return { id: 'T' + (TID++), kind, key, ...extra };
}
function tabMeta(tab) {
  switch (tab.kind) {
    case 'file': { const f = window.FILES[tab.key]; return { title: tab.key, icon: 'file', cls: f ? f.cls : 'ico-md', dirty: f && f.dirty }; }
    case 'browser': return { title: (tab.meta.url || 'localhost:3000').replace(/^https?:\/\//, ''), icon: 'globe', cls: '' };
    case 'db': return { title: tab.meta.table, icon: 'database', cls: 'ico-db' };
    case 'terminal': return { title: tab.meta.name || 'zsh', icon: 'terminal', cls: '' };
    case 'ssh': return { title: tab.meta.host.name, icon: 'server', cls: '' };
    case 'gitgraph': return { title: 'Commit Graph', icon: 'gitgraph', cls: '' };
    case 'settings': return { title: 'Settings', icon: 'settings', cls: '' };
    default: return { title: 'untitled', icon: 'file', cls: '' };
  }
}

const RAIL = [
  { id: 'explorer', icon: 'files', label: 'Explorer', panel: 'ExplorerPanel' },
  { id: 'search', icon: 'search', label: 'Search', panel: 'SearchPanel' },
  { id: 'git', icon: 'git', label: 'Source Control', panel: 'GitPanel', badge: 4 },
  { id: 'database', icon: 'database', label: 'Databases', panel: 'DatabasePanel' },
  { id: 'remote', icon: 'server', label: 'Remotes (SSH/SFTP)', panel: 'RemotePanel' },
  { id: 'browser', icon: 'globe', label: 'Browser', panel: 'BrowserPanel' },
  { id: 'terminal', icon: 'terminal', label: 'Terminal', panel: 'TerminalPanel' },
];
const RAIL_BOTTOM = [
  { id: 'settings', icon: 'settings', label: 'Settings', panel: 'SettingsPanel' },
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const theme = t.theme;
  const accent = t.accent;
  const setTheme = (v) => setTweak('theme', typeof v === 'function' ? v(theme) : v);
  const setAccent = (v) => setTweak('accent', v);
  const [activeFn, setActiveFn] = useState('explorer');
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelW, setPanelW] = useState(t.sidebarWidth);
  const [projId, setProjId] = useState('api');
  const [projMenu, setProjMenu] = useState(false);
  const [optMenu, setOptMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [toast, setToast] = useState(null);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1900); };

  const [groups, setGroups] = useState([
    { id: 'g1', active: null, tabs: [] },
  ]);
  const [focus, setFocus] = useState('g1');

  // sidebar width follows the tweak default (until user drags)
  useEffect(() => { setPanelW(t.sidebarWidth); }, [t.sidebarWidth]);

  const sceneTab = (scene) => {
    switch (scene) {
      case 'editor': return mkTab('file', 'server.ts');
      case 'db': return mkTab('db', 'local.users', { meta: { db: window.databases[0], table: 'users' } });
      case 'browser': return mkTab('browser', null, { meta: { url: 'localhost:3000' } });
      case 'ssh': return mkTab('ssh', 'edge', { meta: { host: window.sshHosts[0] } });
      default: return mkTab('file', 'server.ts');
    }
  };

  // seed initial tabs — default scene first
  useEffect(() => {
    const first = sceneTab(t.defaultScene);
    const t1 = mkTab('file', 'server.ts');
    const t2 = mkTab('file', 'users.ts');
    const t3 = mkTab('browser', null, { meta: { url: 'localhost:3000' } });
    const seed = [first];
    if (first.kind !== 'file') seed.push(t1);
    seed.push(t2);
    if (first.kind !== 'browser') seed.push(t3);
    setGroups([{ id: 'g1', tabs: seed, active: first.id }]);
  }, []);

  const proj = window.projects.find(p => p.id === projId);

  /* ---- open helpers (into focused group) ---- */
  const openTab = useCallback((kind, key, extra, matchFn) => {
    setGroups(gs => gs.map(g => {
      if (g.id !== focus) return g;
      const exist = g.tabs.find(t => (matchFn ? matchFn(t) : (t.kind === kind && t.key === key)));
      if (exist) return { ...g, active: exist.id };
      const nt = mkTab(kind, key, extra);
      return { ...g, tabs: [...g.tabs, nt], active: nt.id };
    }));
  }, [focus]);

  const api = {
    theme, setTheme, accent, setAccent,
    activeProject: proj,
    isActiveFile: (file) => {
      const g = groups.find(x => x.id === focus); if (!g) return false;
      const at = g.tabs.find(t => t.id === g.active); return at && at.kind === 'file' && at.key === file;
    },
    openFile: (file) => openTab('file', file),
    openBrowser: (url) => openTab('browser', null, { meta: { url } }, t => t.kind === 'browser'),
    openDb: (db, table) => openTab('db', db.id + '.' + table, { meta: { db, table } }),
    openSsh: (host) => openTab('ssh', host.id, { meta: { host } }),
    openTerminal: (name) => openTab('terminal', name || 'zsh', { meta: { name } }, t => t.kind === 'terminal'),
    openGitGraph: () => openTab('gitgraph', 'graph', {}, t => t.kind === 'gitgraph'),
    openSettings: () => openTab('settings', 'settings', {}, t => t.kind === 'settings'),
    flash,
  };

  /* ---- tab ops ---- */
  const selectTab = (gid, tid) => { setGroups(gs => gs.map(g => g.id === gid ? { ...g, active: tid } : g)); setFocus(gid); };
  const closeTab = (gid, tid, e) => {
    e && e.stopPropagation();
    setGroups(gs => {
      let next = gs.map(g => {
        if (g.id !== gid) return g;
        const idx = g.tabs.findIndex(t => t.id === tid);
        const tabs = g.tabs.filter(t => t.id !== tid);
        let active = g.active;
        if (g.active === tid) active = tabs.length ? (tabs[Math.max(0, idx - 1)].id) : null;
        return { ...g, tabs, active };
      });
      next = next.filter(g => g.tabs.length > 0 || next.length === 1);
      if (next.length && !next.find(g => g.id === focus)) setFocus(next[0].id);
      return next.length ? next : [{ id: 'g1', tabs: [], active: null }];
    });
  };
  const splitRight = () => {
    setGroups(gs => {
      if (gs.length >= 2) return gs;
      const g = gs.find(x => x.id === focus) || gs[0];
      const at = g.tabs.find(t => t.id === g.active);
      if (!at) return gs;
      const clone = { ...at, id: 'T' + (TID++) };
      const ng = { id: 'g2', tabs: [clone], active: clone.id };
      setTimeout(() => setFocus('g2'), 0);
      return [...gs, ng];
    });
  };
  const moveToOther = (gid, tid) => {
    setGroups(gs => {
      if (gs.length < 2) { // create the second group with this tab
        const src = gs[0]; const t = src.tabs.find(x => x.id === tid);
        const remain = src.tabs.filter(x => x.id !== tid);
        const ng = { id: 'g2', tabs: [{ ...t }], active: t.id };
        setTimeout(() => setFocus('g2'), 0);
        return [{ ...src, tabs: remain, active: remain.length ? remain[remain.length - 1].id : null }, ng];
      }
      const srcIdx = gs.findIndex(g => g.id === gid); const dstIdx = srcIdx === 0 ? 1 : 0;
      const t = gs[srcIdx].tabs.find(x => x.id === tid);
      let res = gs.map((g, i) => {
        if (i === srcIdx) { const remain = g.tabs.filter(x => x.id !== tid); return { ...g, tabs: remain, active: g.active === tid ? (remain.length ? remain[remain.length - 1].id : null) : g.active }; }
        if (i === dstIdx) { const exists = g.tabs.find(x => x.kind === t.kind && x.key === t.key); if (exists) return { ...g, active: exists.id }; return { ...g, tabs: [...g.tabs, { ...t }], active: t.id }; }
        return g;
      });
      res = res.filter(g => g.tabs.length > 0);
      return res;
    });
  };

  /* ---- rail click ---- */
  const railClick = (item) => {
    if (activeFn === item.id && panelOpen) { setPanelOpen(false); return; }
    setActiveFn(item.id); setPanelOpen(true);
    if (item.id === 'terminal') api.openTerminal();
    if (item.id === 'browser') {/* panel only */}
  };

  /* ---- theme/accent on root ---- */
  const rootStyle = {
    '--yuzu': accent,
    '--yuzu-bright': accent,
    '--yuzu-wash': `color-mix(in srgb, ${accent} ${theme === 'dark' ? '16%' : '14%'}, ${theme === 'dark' ? '#0a0e15' : '#ffffff'})`,
    '--yuzu-edge': `color-mix(in srgb, ${accent} 45%, transparent)`,
    '--code-size': t.codeSize + 'px',
  };

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); splitRight(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setPanelOpen(o => !o); }
      if (e.key === 'Escape') { setPalette(false); setProjMenu(false); setOptMenu(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---- panel resize ---- */
  const dragRef = useRef(null);
  const startDrag = (e) => {
    dragRef.current = { x: e.clientX, w: panelW };
    const move = (ev) => { const dw = ev.clientX - dragRef.current.x; setPanelW(Math.max(180, Math.min(460, dragRef.current.w + dw))); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  };

  const PanelComp = window.Panels[[...RAIL, ...RAIL_BOTTOM].find(r => r.id === activeFn)?.panel] || (() => null);

  return (
    <div className="yz" data-theme={theme} data-density={t.density} style={rootStyle} onClick={() => { setProjMenu(false); setOptMenu(false); }}>
      {/* ====== TITLE BAR ====== */}
      <div className="titlebar">
        <div className="traffic"><i className="r" /><i className="y" /><i className="g" /></div>
        <div style={{ position: 'relative' }}>
          <div className="proj" onClick={(e) => { e.stopPropagation(); setProjMenu(v => !v); setOptMenu(false); }}>
            <span className="glyph">{proj.glyph}</span>
            <span className="pname">{proj.name}</span>
            <span className="pbranch"><Icon name="branch" style={{ width: 12, height: 12 }} />{proj.branch}</span>
            <Icon name="chevD" style={{ width: 14, height: 14, color: 'var(--txt-faint)' }} />
          </div>
          {projMenu && (
            <div className="menu" style={{ top: 34, left: 0 }} onClick={e => e.stopPropagation()}>
              <div className="mlabel">Switch project</div>
              {window.projects.map(p => (
                <div className="mi" key={p.id} onClick={() => { setProjId(p.id); setProjMenu(false); }}>
                  <span className="glyph" style={{ width: 18, height: 18 }}>{p.glyph}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--txt-faint)' }}>{p.path}</span>
                  </div>
                  {p.id === projId && <Icon name="check" className="chk" />}
                </div>
              ))}
              <div className="msep" />
              <div className="mi"><Icon name="folder" /> Open folder…</div>
              <div className="mi"><Icon name="plug" /> Clone repository…</div>
            </div>
          )}
        </div>

        <div className="tb-spacer" />

        <span className="badge2 green" style={{ marginRight: 4 }}><span className="d" />dev :3000</span>
        <button className="kbd" onClick={() => setPalette(true)}><Icon name="search" style={{ width: 14, height: 14 }} /> Search or run a command <kbd>⌘K</kbd></button>
        <div className="tb-actions" style={{ marginLeft: 4 }}>
          <button className={'iconbtn' + (panelOpen ? ' on' : '')} title="Toggle sidebar (⌘B)" onClick={() => setPanelOpen(o => !o)}><Icon name="sidebar" /></button>
          <button className="iconbtn" title="Split editor (⌘\\)" onClick={splitRight}><Icon name="splitH" /></button>
          <button className="iconbtn" title="Toggle theme" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          <div style={{ position: 'relative' }}>
            <button className="iconbtn" title="More" onClick={(e) => { e.stopPropagation(); setOptMenu(v => !v); setProjMenu(false); }}><Icon name="dotsV" /></button>
            {optMenu && (
              <div className="menu" style={{ top: 32, right: 0 }} onClick={e => e.stopPropagation()}>
                <div className="mi" onClick={() => { api.openSettings(); setOptMenu(false); }}><Icon name="settings" /> Settings</div>
                <div className="mi"><Icon name="bell" /> Notifications</div>
                <div className="msep" />
                <div className="mi"><Icon name="info" /> About Yuuzu</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====== BODY ====== */}
      <div className="body">
        {/* rail */}
        <div className="rail">
          {RAIL.map(item => (
            <button key={item.id} className={'railbtn' + (activeFn === item.id ? ' on' : '') + (item.hero ? ' hero' : '')} title={item.label} onClick={() => railClick(item)}>
              <Icon name={item.icon} />
              {item.badge && <span className="badge">{item.badge}</span>}
            </button>
          ))}
          <div className="grow" />
          {RAIL_BOTTOM.map(item => (
            <button key={item.id} className={'railbtn' + (activeFn === item.id ? ' on' : '')} title={item.label} onClick={() => railClick(item)}>
              <Icon name={item.icon} />
            </button>
          ))}
        </div>

        {/* content panel */}
        {panelOpen && (
          <>
            <div className="panel" style={{ width: panelW }}>
              <PanelComp api={api} />
            </div>
            <div className="resizer" onMouseDown={startDrag} />
          </>
        )}

        {/* editor groups */}
        <div className="editor-region">
          {groups.map(g => (
            <EditorGroup key={g.id} group={g} focused={focus === g.id} multi={groups.length > 1}
              onFocus={() => setFocus(g.id)} onSelect={selectTab} onClose={closeTab} onMove={moveToOther} onSplit={splitRight} api={api} />
          ))}
        </div>
      </div>

      {/* ====== STATUS BAR ====== */}
      <div className="statusbar">
        <div className="sb accent"><Icon name="branch" /> {proj.branch}</div>
        <div className="sb"><Icon name="rotate" style={{ width: 12, height: 12 }} /> 1↓ 2↑</div>
        <div className="sb"><Icon name="x" style={{ width: 12, height: 12, color: 'var(--c-tag)' }} /> 0 <Icon name="warn" style={{ width: 12, height: 12, color: 'var(--c-attr)' }} /> 3</div>
        <div className="sb-spacer" />
        <div className="sb"><span className="live" /> dev server</div>
        <div className="sb">Ln 9, Col 24</div>
        <div className="sb">Spaces: 2</div>
        <div className="sb">UTF-8</div>
        <div className="sb">TypeScript</div>
        <div className="sb"><Icon name="bell" style={{ width: 12, height: 12 }} /></div>
      </div>

      {palette && <Palette api={api} close={() => setPalette(false)} setTheme={setTheme} setActiveFn={(id) => { setActiveFn(id); setPanelOpen(true); }} split={splitRight} />}
      {toast && <div className="toast"><Icon name="check" />{toast}</div>}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={t.theme} options={['dark', 'light']} onChange={(v) => setTweak('theme', v)} />
        <TweakColor label="Accent" value={t.accent} options={ACCENTS.map(a => a.v)} onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={['compact', 'regular', 'comfy']} onChange={(v) => setTweak('density', v)} />
        <TweakSlider label="Code size" value={t.codeSize} min={11} max={17} step={1} unit="px" onChange={(v) => setTweak('codeSize', v)} />
        <TweakSlider label="Sidebar width" value={t.sidebarWidth} min={200} max={400} step={4} unit="px" onChange={(v) => setTweak('sidebarWidth', v)} />
        <TweakSection label="Default scene" />
        <TweakSelect label="Opens with" value={t.defaultScene} options={SCENES.map(s => s.v)} onChange={(v) => { setTweak('defaultScene', v); const nt = sceneTab(v); setGroups(gs => gs.map(g => g.id === focus ? { ...g, tabs: g.tabs.find(x => x.kind === nt.kind && x.key === nt.key) ? g.tabs : [...g.tabs, nt], active: (g.tabs.find(x => x.kind === nt.kind && x.key === nt.key) || nt).id } : g)); }} />
      </TweaksPanel>
    </div>
  );
}

/* ====== Editor group ====== */
function EditorGroup({ group, focused, multi, onFocus, onSelect, onClose, onMove, onSplit, api }) {
  const active = group.tabs.find(t => t.id === group.active);
  return (
    <div className={'group' + (focused ? ' focus' : '')} onMouseDown={onFocus}>
      <div className="tabstrip">
        {group.tabs.map(t => {
          const m = tabMeta(t);
          return (
            <div key={t.id} className={'tab' + (t.id === group.active ? ' active' : '')} onClick={() => onSelect(group.id, t.id)}>
              <Icon name={m.icon} className={'ftype ' + m.cls} />
              <span className={'tlabel mono' + (m.dirty ? ' dirty' : '')}>{m.title}</span>
              {m.dirty
                ? <span className="dirtydot" onClick={(e) => onClose(group.id, t.id, e)} />
                : <span className="close" onClick={(e) => onClose(group.id, t.id, e)}><Icon name="x" /></span>}
            </div>
          );
        })}
        <div className="tabstrip-tail">
          {active && <button className="iconbtn" title={multi ? 'Move to other group' : 'Split right (⌘\\)'} onClick={() => multi ? onMove(group.id, active.id) : onSplit()}><Icon name={multi ? 'arrowR' : 'splitH'} /></button>}
          <button className="iconbtn" title="More"><Icon name="dots" /></button>
        </div>
      </div>
      {active ? <Scene tab={active} api={api} /> : (
        <div className="empty"><div className="ec"><div className="big mono">⌘</div><div>No editor open</div><div style={{ fontSize: 12, marginTop: 4 }}>Press <kbd className="ds-code">⌘K</kbd> to search</div></div></div>
      )}
    </div>
  );
}

function Scene({ tab, api }) {
  const S = window.Scenes;
  switch (tab.kind) {
    case 'file': return <S.CodeEditor file={tab.key} />;
    case 'browser': return <S.BrowserScene url={tab.meta.url} />;
    case 'db': return <S.DbScene meta={tab.meta} />;
    case 'terminal': return <S.TerminalScene />;
    case 'ssh': return <S.SshScene meta={tab.meta} />;
    case 'gitgraph': return <S.GitGraphScene />;
    case 'settings': return <S.SettingsScene api={api} />;
    default: return null;
  }
}

/* ====== Command palette ====== */
function Palette({ api, close, setTheme, setActiveFn, split }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);
  const cmds = [
    { cat: 'Files', items: [
      { l: 'server.ts', s: 'src/server.ts', icon: 'file', run: () => api.openFile('server.ts') },
      { l: 'users.ts', s: 'src/routes/users.ts', icon: 'file', run: () => api.openFile('users.ts') },
      { l: 'schema.sql', s: 'src/db/schema.sql', icon: 'database', run: () => api.openFile('schema.sql') },
      { l: 'README.md', s: 'README.md', icon: 'file', run: () => api.openFile('README.md') },
    ]},
    { cat: 'Commands', items: [
      { l: 'View: Toggle Theme', s: '', icon: 'sun', run: () => setTheme(t => t === 'dark' ? 'light' : 'dark') },
      { l: 'View: Split Editor Right', s: '⌘\\', icon: 'splitH', run: () => split() },
      { l: 'Git: Open Commit Graph', s: '', icon: 'gitgraph', run: () => api.openGitGraph() },
      { l: 'Database: New Query', s: '', icon: 'database', run: () => api.openDb(window.databases[0], 'users') },
      { l: 'Remote: Connect to edge-01', s: '', icon: 'server', run: () => api.openSsh(window.sshHosts[0]) },
      { l: 'Terminal: New Terminal', s: '⌃`', icon: 'terminal', run: () => api.openTerminal() },
      { l: 'Browser: Open localhost:3000', s: '', icon: 'globe', run: () => api.openBrowser('localhost:3000') },
      { l: 'Preferences: Open Settings', s: '', icon: 'settings', run: () => api.openSettings() },
    ]},
  ];
  const flat = [];
  cmds.forEach(c => { const items = c.items.filter(it => !q || it.l.toLowerCase().includes(q.toLowerCase())); if (items.length) flat.push({ cat: c.cat, items }); });
  const linear = flat.flatMap(c => c.items);
  const run = (it) => { it.run(); close(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(linear.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); linear[sel] && run(linear[sel]); }
  };
  let idx = -1;
  return (
    <div className="palette-scrim" onClick={close}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} placeholder="Search files or run a command…" />
          <span className="badge2 mono">esc</span>
        </div>
        <div className="palette-list">
          {flat.map((c, ci) => (
            <div key={ci}>
              <div className="pal-cat">{c.cat}</div>
              {c.items.map((it, ii) => { idx++; const cur = idx; return (
                <div key={ii} className={'pal-row' + (sel === cur ? ' on' : '')} onMouseEnter={() => setSel(cur)} onClick={() => run(it)}>
                  <Icon name={it.icon} /><span className="pl">{it.l}</span>{it.s && <span className="ps">{it.s}</span>}
                </div>
              ); })}
            </div>
          ))}
          {!linear.length && <div className="pal-row" style={{ color: 'var(--txt-faint)' }}>No matching commands</div>}
        </div>
      </div>
    </div>
  );
}

/* ====== Export generated prompts modal ====== */
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
