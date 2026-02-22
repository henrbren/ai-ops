import express from 'express';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 8787;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/mimir_control'
});

const execFileAsync = promisify(execFile);

async function ensureSchema(client) {
  await client.query(`create schema if not exists mimir`);
  await client.query(`
    create table if not exists mimir.dashboard_github_stats (
      id bigserial primary key,
      fetched_at timestamptz not null default now(),
      open_prs int,
      prs_with_failing_checks int,
      release_queued_items int,
      raw jsonb
    )
  `);
}

app.get('/', async (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="no">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Mimir Dashboard</title>
  <style>
    :root{color-scheme:dark; --bg:#0b0e14; --card:#121826; --muted:#9aa4b2; --fg:#e6edf3; --accent:#7c3aed; --bad:#ef4444; --ok:#22c55e; --warn:#f59e0b;}
    body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;}
    header{padding:16px 20px;border-bottom:1px solid #1f2937;display:flex;justify-content:space-between;gap:12px;align-items:baseline;}
    header h1{font-size:16px;margin:0;}
    header .muted{color:var(--muted)}
    main{padding:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;}
    .card{background:var(--card);border:1px solid #1f2937;border-radius:12px;padding:14px;}
    .card h2{font-size:13px;margin:0 0 10px 0;color:#cbd5e1;letter-spacing:.02em;text-transform:uppercase;}
    .row{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:6px 0;}
    .pill{border:1px solid #243041;background:#0f1522;border-radius:999px;padding:6px 10px;color:#cbd5e1;display:inline-flex;gap:8px;align-items:center}
    .dot{width:10px;height:10px;border-radius:999px;background:var(--muted)}
    a{color:#c4b5fd;text-decoration:none}
    a:hover{text-decoration:underline}
    code{color:#cbd5e1}
    .runs{display:flex;flex-direction:column;gap:8px}
    .run{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .run .left{display:flex;flex-direction:column;gap:2px}
    .badge{font-size:12px;border:1px solid #243041;background:#0f1522;border-radius:999px;padding:2px 8px;color:#cbd5e1;white-space:nowrap}
    .badge.ok{border-color:rgba(34,197,94,.4);color:var(--ok)}
    .badge.warn{border-color:rgba(245,158,11,.4);color:var(--warn)}
    .badge.fail{border-color:rgba(239,68,68,.4);color:var(--bad)}
  </style>
</head>
<body>
<header>
  <h1>Mimir Dashboard</h1>
  <div class="muted" id="now">…</div>
</header>
<main>
  <section class="card">
    <h2>Status</h2>
    <div class="row"><div>Siste morning routine</div><div id="mr">…</div></div>
    <div class="row"><div>Siste dashboard build</div><div id="dr">…</div></div>
    <div class="row"><div>LAFT store batch</div><div class="pill"><span class="dot" style="background:var(--accent)"></span>Tor 15:00</div></div>
    <div class="row"><a href="https://github.com/henrbren/ai-ops/issues/2" target="_blank">Rapporter (issue #2)</a><span></span></div>
  </section>

  <section class="card" id="runs_card">
    <h2>Runs</h2>
    <div class="muted" style="margin:-4px 0 10px 0">Siste kjøringer fra <code>mimir.runs</code></div>
    <div id="runs" class="muted">Laster…</div>
  </section>

  <section class="card">
    <h2>GitHub</h2>
    <div class="row"><div>Open PRs</div><div id="gh_prs">…</div></div>
    <div class="row"><div>PRs w/ failing checks</div><div id="gh_fail">…</div></div>
    <div class="row"><div>release:queued</div><div id="gh_rel">…</div></div>
    <div class="muted" id="gh_meta"></div>
  </section>

  <section class="card">
    <h2>Kontrollplan</h2>
    <div class="row"><div>DB</div><div class="pill"><span class="dot" style="background:var(--ok)"></span><code>mimir_control</code></div></div>
    <div class="row"><div>Schema</div><div class="pill"><code>mimir</code></div></div>
    <div class="row"><div>Server</div><div class="pill"><code>localhost:${port}</code></div></div>
  </section>

  <section class="card">
    <h2>Daglig cadence</h2>
    <div class="row"><div>Morning routine</div><div class="pill"><code>09:00</code></div></div>
    <div class="row"><div>Dashboard feature</div><div class="pill"><code>10:00</code> (foreslått)</div></div>
    <div class="muted">Endre tid når du vil. Jeg setter den opp nå med 10:00 som default.</div>
  </section>
</main>
<script>
  document.getElementById('now').textContent = new Date().toLocaleString('no-NO');
  function esc(s){
    return String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  }

  async function loadRuns(){
    const r = await fetch('/api/runs?limit=12');
    const j = await r.json();
    const el = document.getElementById('runs');
    if (!Array.isArray(j?.runs) || j.runs.length === 0) {
      el.textContent = 'Ingen runs ennå.';
      return;
    }

    el.classList.remove('muted');
    el.classList.add('runs');

    el.innerHTML = j.runs.map(run => {
      const when = new Date(run.started_at).toLocaleString('no-NO');
      const badge = '<span class="badge ' + esc(run.status) + '">' + esc(run.status) + '</span>';
      const summary = run.summary ? '<div class="muted">' + esc(run.summary) + '</div>' : '';
      return (
        '<div class="run">' +
          '<div class="left">' +
            '<div><code>' + esc(run.kind) + '</code> · <span class="muted">' + esc(when) + '</span></div>' +
            summary +
          '</div>' +
          '<div>' + badge + '</div>' +
        '</div>'
      );
    }).join('');
  }

  async function load(){
    const r = await fetch('/api/status');
    const j = await r.json();
    document.getElementById('mr').textContent = j.morningRoutine || '—';
    document.getElementById('dr').textContent = j.dashboardDaily || '—';

    if (j.github) {
      document.getElementById('gh_prs').textContent = String(j.github.open_prs ?? '—');
      document.getElementById('gh_fail').textContent = String(j.github.prs_with_failing_checks ?? '—');
      document.getElementById('gh_rel').textContent = String(j.github.release_queued_items ?? '—');
      document.getElementById('gh_meta').textContent = 'Sist oppdatert: ' + new Date(j.github.fetched_at).toLocaleString('no-NO');
    }

    loadRuns().catch(()=>{});

    // Nudge-refresh github stats (cached ~60s server-side)
    fetch('/api/github').catch(()=>{});
  }
  load().catch(()=>{});
  setInterval(load, 5000);
</script>
</body>
</html>`);
});

app.get('/api/status', async (_req, res) => {
  const client = await pool.connect();
  try {
    await ensureSchema(client);

    const mr = await client.query(
      `select started_at, status from mimir.runs where kind='morning_routine' order by started_at desc limit 1`
    );
    const dr = await client.query(
      `select started_at, status from mimir.runs where kind='dashboard_daily' order by started_at desc limit 1`
    );
    const gh = await client.query(
      `select fetched_at, open_prs, prs_with_failing_checks, release_queued_items from mimir.dashboard_github_stats order by fetched_at desc limit 1`
    );

    const fmt = (row) => row ? `${new Date(row.started_at).toLocaleString('no-NO')} · ${row.status}` : null;

    res.json({
      morningRoutine: mr.rows[0] ? fmt(mr.rows[0]) : null,
      dashboardDaily: dr.rows[0] ? fmt(dr.rows[0]) : null,
      github: gh.rows[0] || null
    });
  } finally {
    client.release();
  }
});

app.get('/api/runs', async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureSchema(client);

    const kind = req.query.kind ? String(req.query.kind) : null;
    const limitRaw = req.query.limit ? Number(req.query.limit) : 20;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 100) : 20;

    const q = kind
      ? {
          text: `select id, kind, status, started_at, finished_at, summary from mimir.runs where kind=$1 order by started_at desc limit $2`,
          values: [kind, limit]
        }
      : {
          text: `select id, kind, status, started_at, finished_at, summary from mimir.runs order by started_at desc limit $1`,
          values: [limit]
        };

    const r = await client.query(q);
    res.json({ runs: r.rows });
  } finally {
    client.release();
  }
});

app.get('/api/github', async (_req, res) => {
  const client = await pool.connect();
  try {
    await ensureSchema(client);

    const cached = await client.query(
      `select * from mimir.dashboard_github_stats order by fetched_at desc limit 1`
    );

    if (cached.rows[0]) {
      const ageMs = Date.now() - new Date(cached.rows[0].fetched_at).getTime();
      if (ageMs < 60_000) return res.json({ source: 'cache', ...cached.rows[0] });
    }

    // Fetch fresh via gh CLI. If gh isn't authenticated, return cached row (if any) and a warning.
    const repo = process.env.GITHUB_REPO || 'henrbren/ai-ops';

    const prList = await execFileAsync('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json', 'number,statusCheckRollup'], { timeout: 5000 });
    const prs = JSON.parse(prList.stdout || '[]');

    const openPRs = prs.length;
    const prsWithFailingChecks = prs.filter(pr => {
      const rollup = pr.statusCheckRollup || [];
      return rollup.some(c => {
        const conclusion = (c.conclusion || '').toUpperCase();
        if (!conclusion) return false; // pending/unknown ≠ failing
        return !['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion);
      });
    }).length;

    const relList = await execFileAsync('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--label', 'release:queued', '--limit', '200', '--json', 'number'], { timeout: 5000 });
    const relItems = JSON.parse(relList.stdout || '[]');
    const releaseQueuedItems = relItems.length;

    const raw = { repo, openPRs, prsWithFailingChecks, releaseQueuedItems };

    const ins = await client.query(
      `insert into mimir.dashboard_github_stats(open_prs, prs_with_failing_checks, release_queued_items, raw)
       values ($1,$2,$3,$4)
       returning *`,
      [openPRs, prsWithFailingChecks, releaseQueuedItems, raw]
    );

    res.json({ source: 'fresh', ...ins.rows[0] });
  } catch (e) {
    const cached = await client.query(
      `select * from mimir.dashboard_github_stats order by fetched_at desc limit 1`
    );
    res.status(200).json({
      source: 'error',
      error: String(e?.message || e),
      cached: cached.rows[0] || null
    });
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  console.log(`Dashboard running on http://localhost:${port}`);
});
