/* Yuuzu-IDE — mock data + tokenizer */

/* ---------- syntax tokenizer (lightweight, visual only) ---------- */
const KW = new Set(('const let var function return if else for while import from export default '
  + 'async await class extends new this typeof instanceof of in try catch finally throw '
  + 'interface type enum public private readonly void null undefined true false static get set '
  + 'pub fn use mut impl struct match Some None Ok Err where as').split(' '));
const KW2 = new Set('string number boolean any Promise Array Record Response Request Express Router'.split(' '));

function tokJS(line) {
  const out = []; let i = 0;
  const push = (cls, txt) => out.push({ cls, txt });
  while (i < line.length) {
    const ch = line[i];
    if (line.startsWith('//', i)) { push('com', line.slice(i)); break; }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1; while (j < line.length && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
      push('str', line.slice(i, j + 1)); i = j + 1; continue;
    }
    if (/[0-9]/.test(ch) && !/[a-zA-Z_]/.test(line[i-1]||'')) {
      let j = i; while (j < line.length && /[0-9._xa-fA-F]/.test(line[j])) j++;
      push('num', line.slice(i, j)); i = j; continue;
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i; while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const w = line.slice(i, j);
      const after = line.slice(j).match(/^\s*\(/);
      if (KW.has(w)) push('key', w);
      else if (KW2.has(w)) push('kw2', w);
      else if (after) push('fn', w);
      else if (/^[A-Z]/.test(w)) push('kw2', w);
      else push('var', w);
      i = j; continue;
    }
    if (/[{}()\[\].,;:=+\-*/<>!&|?]/.test(ch)) { push('punc', ch); i++; continue; }
    push('var', ch); i++;
  }
  return out;
}
function tokSQL(line) {
  const out = []; let i = 0; const push = (cls, txt) => out.push({ cls, txt });
  const SQLKW = /^(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP BY|ORDER BY|LIMIT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|PRIMARY KEY|FOREIGN KEY|REFERENCES|NOT NULL|DEFAULT|INTEGER|TEXT|VARCHAR|TIMESTAMP|SERIAL|BOOLEAN|AND|OR|AS|DESC|ASC|COUNT|DISTINCT|INDEX)\b/i;
  while (i < line.length) {
    if (line.startsWith('--', i)) { push('com', line.slice(i)); break; }
    const rest = line.slice(i); const m = rest.match(SQLKW);
    if (m && !/[a-zA-Z_]/.test(line[i-1]||'')) { push('key', m[0]); i += m[0].length; continue; }
    const ch = line[i];
    if (ch === "'") { let j = i+1; while (j<line.length && line[j] !== "'") j++; push('str', line.slice(i, j+1)); i=j+1; continue; }
    if (/[0-9]/.test(ch)) { let j=i; while(j<line.length && /[0-9.]/.test(line[j])) j++; push('num', line.slice(i,j)); i=j; continue; }
    if (/[a-zA-Z_]/.test(ch)) { let j=i; while(j<line.length && /[a-zA-Z0-9_]/.test(line[j])) j++; push('var', line.slice(i,j)); i=j; continue; }
    if (/[(),;.*=<>]/.test(ch)) { push('punc', ch); i++; continue; }
    push('var', ch); i++;
  }
  return out;
}
function tokMD(line) {
  if (/^#{1,6}\s/.test(line)) return [{ cls: 'fn', txt: line }];
  if (/^\s*[-*]\s/.test(line)) return [{ cls: 'key', txt: line.match(/^\s*[-*]/)[0] }, { cls: 'var', txt: line.replace(/^\s*[-*]/, '') }];
  if (/^>/.test(line)) return [{ cls: 'com', txt: line }];
  const out = []; let rest = line; const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/;
  let m; while ((m = rest.match(re))) { const idx = m.index; if (idx > 0) out.push({ cls: 'var', txt: rest.slice(0, idx) }); const t = m[0]; out.push({ cls: t[0] === '`' ? 'str' : t[0] === '[' ? 'fn' : 'kw2', txt: t }); rest = rest.slice(idx + t.length); }
  if (rest) out.push({ cls: 'var', txt: rest }); return out.length ? out : [{ cls: 'var', txt: line }];
}
function tokJSON(line) {
  const out = []; const re = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\b\d+\.?\d*\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}\[\],:])/g;
  let last = 0, m;
  while ((m = re.exec(line))) { if (m.index > last) out.push({ cls: 'var', txt: line.slice(last, m.index) });
    if (m[1]) out.push({ cls: 'tag', txt: m[1] }); else if (m[2]) out.push({ cls: 'str', txt: m[2] });
    else if (m[3]) out.push({ cls: 'num', txt: m[3] }); else if (m[4]) out.push({ cls: 'key', txt: m[4] });
    else out.push({ cls: 'punc', txt: m[5] }); last = re.lastIndex; }
  if (last < line.length) out.push({ cls: 'var', txt: line.slice(last) }); return out;
}
window.tokenize = function (line, lang) {
  if (!line) return [{ cls: 'var', txt: '' }];
  if (lang === 'sql') return tokSQL(line);
  if (lang === 'md') return tokMD(line);
  if (lang === 'json') return tokJSON(line);
  return tokJS(line);
};

/* ---------- file contents ---------- */
const F = {};
F['server.ts'] = { lang: 'ts', icon: 'ts', cls: 'ico-ts', path: 'src/server.ts', body:
`import express from "express";
import { createConnection } from "./db/pool";
import { usersRouter } from "./routes/users";
import { logger } from "./lib/logger";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(logger);

// Mount the resource routers
app.use("/api/users", usersRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

async function main() {
  const db = await createConnection();
  logger.info(\`connected to \${db.dialect}\`);
  app.listen(PORT, () => {
    logger.info(\`yuuzu api listening on :\${PORT}\`);
  });
}

main().catch((err) => {
  logger.error("fatal", err);
  process.exit(1);
});` };

F['users.ts'] = { lang: 'ts', icon: 'ts', cls: 'ico-ts', path: 'src/routes/users.ts', dirty: true, body:
`import { Router } from "express";
import { db } from "../db/pool";

export const usersRouter = Router();

usersRouter.get("/", async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const rows = await db.query(
    "SELECT id, name, email, role FROM users LIMIT 50 OFFSET $1",
    [(page - 1) * 50]
  );
  res.json({ data: rows, page });
});

usersRouter.post("/", async (req, res) => {
  const { name, email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  const [user] = await db.query(
    "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
    [name, email]
  );
  res.status(201).json(user);
});` };

F['schema.sql'] = { lang: 'sql', icon: 'db', cls: 'ico-db', path: 'src/db/schema.sql', body:
`-- Yuuzu sample schema
CREATE TABLE users (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(120) NOT NULL,
  email     VARCHAR(255) NOT NULL,
  role      VARCHAR(32) DEFAULT 'member',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE projects (
  id        SERIAL PRIMARY KEY,
  owner_id  INTEGER REFERENCES users(id),
  name      VARCHAR(120) NOT NULL,
  archived  BOOLEAN DEFAULT false
);

CREATE INDEX idx_projects_owner ON projects(owner_id);` };

F['README.md'] = { lang: 'md', icon: 'md', cls: 'ico-md', path: 'README.md', body:
`# yuuzu-api

A small, **CLI-first** service that powers the Yuuzu workspace.

## Getting started

\`\`\`
npx yuuzu dev --port 3000
\`\`\`

- Postgres, SQLite and MSSQL are supported out of the box
- SSH + SFTP remotes are managed from the rail
- See [the docs](https://yuuzu.dev) for more

> Everything you need, one keystroke away.` };

F['package.json'] = { lang: 'json', icon: 'json', cls: 'ico-json', path: 'package.json', body:
`{
  "name": "yuuzu-api",
  "version": "0.4.2",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p .",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.11.5"
  }
}` };

/* ---------- file tree ---------- */
const tree = [
  { type: 'folder', name: 'src', open: true, git: '', children: [
    { type: 'folder', name: 'db', open: true, children: [
      { type: 'file', name: 'pool.ts', icon: 'ts', cls: 'ico-ts' },
      { type: 'file', name: 'schema.sql', icon: 'db', cls: 'ico-db', file: 'schema.sql' },
    ]},
    { type: 'folder', name: 'routes', open: true, children: [
      { type: 'file', name: 'users.ts', icon: 'ts', cls: 'ico-ts', file: 'users.ts', git: 'M' },
      { type: 'file', name: 'projects.ts', icon: 'ts', cls: 'ico-ts' },
    ]},
    { type: 'folder', name: 'lib', children: [
      { type: 'file', name: 'logger.ts', icon: 'ts', cls: 'ico-ts' },
    ]},
    { type: 'file', name: 'server.ts', icon: 'ts', cls: 'ico-ts', file: 'server.ts' },
  ]},
  { type: 'folder', name: 'public', children: [
    { type: 'file', name: 'index.html', icon: 'html', cls: 'ico-html' },
    { type: 'file', name: 'style.css', icon: 'css', cls: 'ico-css' },
  ]},
  { type: 'file', name: '.env', icon: 'file', cls: 'ico-md' },
  { type: 'file', name: 'package.json', icon: 'json', cls: 'ico-json', file: 'package.json', git: 'M' },
  { type: 'file', name: 'README.md', icon: 'md', cls: 'ico-md', file: 'README.md' },
  { type: 'file', name: 'tsconfig.json', icon: 'json', cls: 'ico-json' },
];

/* ---------- projects ---------- */
const projects = [
  { id: 'api', name: 'yuuzu-api', branch: 'main', glyph: 'ヾ', path: '~/dev/yuuzu-api' },
  { id: 'web', name: 'yuuzu-web', branch: 'feat/editor', glyph: 'ゆ', path: '~/dev/yuuzu-web' },
  { id: 'cli', name: 'yuuzu-cli', branch: 'main', glyph: '柚', path: '~/dev/yuuzu-cli' },
];

/* ---------- databases ---------- */
const databases = [
  { id: 'local', kind: 'SQLite', name: 'local.db', sub: '~/dev/yuuzu-api/local.db', status: 'connected',
    tables: [['users', 1243], ['projects', 87], ['sessions', 5219], ['migrations', 12]] },
  { id: 'prod', kind: 'PostgreSQL', name: 'prod · aws-rds', sub: 'db.yuuzu.dev:5432 / yuuzu', status: 'connected',
    tables: [['users', 18402], ['projects', 2310], ['events', 1284551], ['billing', 904]] },
  { id: 'legacy', kind: 'MS SQL Server', name: 'legacy-erp', sub: '10.0.4.21:1433 / ERP', status: 'idle',
    tables: [['Customers', 5521], ['Orders', 88210], ['Invoices', 44120]] },
];
const queryResult = {
  sql: 'SELECT id, name, email, role\nFROM users\nWHERE role = \'admin\'\nORDER BY created_at DESC\nLIMIT 8;',
  cols: ['id', 'name', 'email', 'role', 'created_at'],
  rows: [
    ['1042', 'Mina Okada', 'mina@yuuzu.dev', 'admin', '2026-05-31 09:14'],
    ['1038', 'Theo Brandt', 'theo@yuuzu.dev', 'admin', '2026-05-28 17:02'],
    ['1021', 'Priya Nair', 'priya@yuuzu.dev', 'admin', '2026-05-20 11:48'],
    ['0994', 'Lukas Vogel', 'lukas@yuuzu.dev', 'admin', '2026-05-12 08:33'],
    ['0982', 'Sora Tanaka', 'sora@yuuzu.dev', 'admin', '2026-05-09 22:10'],
    ['0961', 'Elena Rossi', 'elena@yuuzu.dev', 'admin', '2026-04-30 14:55'],
    ['0950', 'Omar Haddad', 'omar@yuuzu.dev', 'admin', '2026-04-22 19:27'],
    ['0938', 'Yuki Mori', 'yuki@yuuzu.dev', 'admin', '2026-04-18 07:41'],
  ],
};

/* ---------- ssh / sftp ---------- */
const sshHosts = [
  { id: 'edge', name: 'edge-01', host: 'edge01.yuuzu.dev', user: 'deploy', status: 'connected' },
  { id: 'worker', name: 'worker-eu', host: '10.0.2.88', user: 'root', status: 'connected' },
  { id: 'backup', name: 'backup-box', host: 'backup.yuuzu.dev', user: 'ops', status: 'idle' },
];
const sftpFiles = [
  { name: '..', dir: true, size: '', mod: '' },
  { name: 'releases', dir: true, size: '4.0K', mod: 'Jun 06 14:20' },
  { name: 'shared', dir: true, size: '4.0K', mod: 'May 28 09:11' },
  { name: 'current', dir: true, size: '12', mod: 'Jun 06 14:21', link: '-> releases/0.4.2' },
  { name: 'deploy.sh', dir: false, size: '2.1K', mod: 'Jun 06 14:18' },
  { name: '.env.production', dir: false, size: '684', mod: 'Jun 01 08:02' },
  { name: 'nginx.conf', dir: false, size: '3.4K', mod: 'May 19 16:40' },
];
const termLines = [
  { t: 'in', text: 'ssh deploy@edge01.yuuzu.dev' },
  { t: 'out', text: 'Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0 x86_64)' },
  { t: 'out', text: ' * Documentation:  https://help.ubuntu.com' },
  { t: 'out', text: 'Last login: Sat Jun  7 09:02:31 2026 from 192.168.1.5' },
  { t: 'in', text: 'systemctl status yuuzu-api' },
  { t: 'out', text: '● yuuzu-api.service - Yuuzu API' },
  { t: 'good', text: '   Active: active (running) since Sat 2026-06-07 08:44:10 UTC' },
  { t: 'out', text: '   Memory: 84.2M   Tasks: 11   CPU: 3.114s' },
  { t: 'in', text: 'tail -n 2 /var/log/yuuzu/api.log' },
  { t: 'out', text: '[09:14:02] INFO  connected to postgres' },
  { t: 'out', text: '[09:14:02] INFO  yuuzu api listening on :3000' },
];

/* ---------- git ---------- */
const gitStaged = [
  { name: 'src/db/pool.ts', git: 'A' },
];
const gitChanges = [
  { name: 'src/routes/users.ts', git: 'M' },
  { name: 'package.json', git: 'M' },
  { name: 'src/lib/logger.ts', git: 'M' },
  { name: 'notes.local.md', git: 'U' },
];
const gitGraph = [
  { hash: 'a3f9c21', msg: 'feat: paginate users endpoint', author: 'mina', when: '2h', refs: ['HEAD -> main'], lane: 0 },
  { hash: '7b18e04', msg: 'fix: pool reconnect on ECONNRESET', author: 'theo', when: '5h', refs: [], lane: 0 },
  { hash: 'c290 a1', msg: 'merge: feat/editor', author: 'mina', when: '1d', refs: ['origin/main'], lane: 0, merge: true },
  { hash: 'f01dd9b', msg: 'wip: split editor groups', author: 'priya', when: '1d', refs: [], lane: 1 },
  { hash: '5ce7720', msg: 'chore: bump deps', author: 'theo', when: '2d', refs: [], lane: 0 },
  { hash: '9aa4c18', msg: 'feat: sftp browser', author: 'mina', when: '3d', refs: ['v0.4.1'], lane: 0 },
  { hash: 'd4b0e55', msg: 'init schema + migrations', author: 'theo', when: '4d', refs: [], lane: 0 },
];

/* ---------- search ---------- */
const searchResults = [
  { file: 'src/routes/users.ts', cls: 'ico-ts', hits: [
    { ln: 7, pre: '  const rows = await db.', m: 'query', post: '(' },
    { ln: 18, pre: '  const [user] = await db.', m: 'query', post: '(' },
  ]},
  { file: 'src/server.ts', cls: 'ico-ts', hits: [
    { ln: 2, pre: 'import { createConnection } from "./db/', m: 'pool', post: '";' },
  ]},
  { file: 'src/db/schema.sql', cls: 'ico-db', hits: [
    { ln: 3, pre: '  id        SERIAL PRIMARY ', m: 'KEY', post: '' },
  ]},
];

/* ---------- Claude Code agent (the CLI) ---------- */
const agentSessions = [
  { id: 's1', title: 'Paginate users endpoint', when: 'now', active: true, msgs: 6 },
  { id: 's2', title: 'Add SFTP reconnect logic', when: '2h', msgs: 14 },
  { id: 's3', title: 'Migrate sessions to Postgres', when: 'yesterday', msgs: 31 },
];

/* transcript blocks: user / text / read / edit / bash / prompt / done */
const agentTranscript = [
  { t: 'user', text: 'add cursor pagination to the users route, 50 per page, and update the SQL' },
  { t: 'text', text: "I'll add pagination to the users endpoint. Let me read the route and the pool helper first." },
  { t: 'read', file: 'src/routes/users.ts', meta: '24 lines' },
  { t: 'read', file: 'src/db/pool.ts', meta: '41 lines' },
  { t: 'text', text: 'The handler returns all rows. I\'ll add a `page` query param and an `OFFSET` clause.' },
  { t: 'edit', file: 'src/routes/users.ts', add: 6, del: 2, diff: [
    { s: '-', c: '  const rows = await db.query("SELECT * FROM users");' },
    { s: '+', c: '  const page = Number(req.query.page ?? 1);' },
    { s: '+', c: '  const rows = await db.query(' },
    { s: '+', c: '    "SELECT id,name,email,role FROM users LIMIT 50 OFFSET $1",' },
    { s: '+', c: '    [(page - 1) * 50]' },
    { s: '+', c: '  );' },
  ]},
  { t: 'bash', cmd: 'npm run build', out: '✔ tsc — compiled in 1.24s', ok: true },
  { t: 'bash', cmd: 'curl -s localhost:3000/api/users?page=2 | jq .page', out: '2', ok: true },
  { t: 'done', text: 'Done. `GET /api/users` now paginates 50 rows per page via `?page=`. Build is green and the endpoint returns the right page.' },
];

/* the structured prompts the agent generated during this run */
const agentPrompts = [
  { id: 'p1', kind: 'Plan', tokens: 86, label: 'Task plan',
    body: `Goal: add cursor pagination to GET /api/users.
Constraints: 50 rows per page; keep response shape { data, page }.
Steps:
1. Read src/routes/users.ts and src/db/pool.ts.
2. Add a \`page\` query param parsed from req.query.
3. Rewrite the SQL with LIMIT 50 OFFSET ($page-1)*50.
4. Build + smoke-test with curl.` },
  { id: 'p2', kind: 'Edit', tokens: 142, label: 'Edit: src/routes/users.ts',
    body: `You are editing src/routes/users.ts.
Replace the unbounded query in the GET "/" handler with a paginated one.
- Parse page: const page = Number(req.query.page ?? 1)
- Query: SELECT id,name,email,role FROM users LIMIT 50 OFFSET $1
- Bind: [(page - 1) * 50]
- Return res.json({ data: rows, page })
Preserve existing imports and the POST handler untouched.` },
  { id: 'p3', kind: 'Verify', tokens: 64, label: 'Verification',
    body: `Verify the change:
1. Run \`npm run build\` — expect 0 type errors.
2. Run \`curl -s localhost:3000/api/users?page=2 | jq .page\` — expect 2.
3. Confirm exactly 50 rows returned for a full page.
Report pass/fail per check.` },
  { id: 'p4', kind: 'System', tokens: 38, label: 'Session system prompt',
    body: `Workspace: ~/dev/yuuzu-api (TypeScript, Express, Postgres).
Conventions: 2-space indent, named exports, parameterized SQL only.
Never edit files outside src/ without confirmation.` },
];

Object.assign(window, {
  FILES: F, tree, projects, databases, queryResult,
  sshHosts, sftpFiles, termLines, gitStaged, gitChanges, gitGraph, searchResults,
  agentTranscript, agentPrompts, agentSessions,
});


