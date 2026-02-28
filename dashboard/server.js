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

  // Shared run log table (used across tools)
  await client.query(`
    create table if not exists mimir.runs (
      id bigserial primary key,
      kind text not null,
      status text not null,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      summary text,
      details jsonb
    )
  `);
  await client.query(`create index if not exists runs_kind_started_at_idx on mimir.runs(kind, started_at desc)`);

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

  // Minimal leads table (shell UI can show "none yet" until ingestion exists)
  await client.query(`
    create table if not exists mimir.leads (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      source text,
      name text,
      email text,
      company text,
      status text not null default 'new',
      notes text
    )
  `);
  await client.query(`create index if not exists leads_created_at_idx on mimir.leads(created_at desc)`);
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
    .banner{border-radius:12px;padding:12px 14px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.08)}
    .banner h2{margin:0 0 6px 0;color:#fecaca;font-size:13px;letter-spacing:.02em;text-transform:uppercase;}
    .row{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:6px 0;}
    .pill{border:1px solid #243041;background:#0f1522;border-radius:999px;padding:6px 10px;color:#cbd5e1;display:inline-flex;gap:8px;align-items:center}
    .dot{width:10px;height:10px;border-radius:999px;background:var(--muted)}
    a{color:#c4b5fd;text-decoration:none}
    a:hover{text-decoration:underline}
    code{color:#cbd5e1}
    select{background:#0f1522;color:var(--fg);border:1px solid #243041;border-radius:10px;padding:6px 10px;font:inherit}
    .runs{display:flex;flex-direction:column;gap:8px}
    .run{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .run.clickable{cursor:pointer}
    .run:hover{border-radius:10px;background:rgba(255,255,255,.03)}
    .run .left{display:flex;flex-direction:column;gap:2px}
    .modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);padding:18px;z-index:50}
    .modal .box{width:min(900px,100%);max-height:80vh;overflow:auto;background:var(--card);border:1px solid #243041;border-radius:12px;padding:14px}
    .modal pre{white-space:pre-wrap;word-break:break-word;background:#0f1522;border:1px solid #243041;border-radius:10px;padding:10px;color:#cbd5e1;}
    .modal .top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}
    .btn{background:#0f1522;color:var(--fg);border:1px solid #243041;border-radius:10px;padding:6px 10px;font:inherit}
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
  <section class="banner" id="incident" style="display:none">
    <h2>Incident</h2>
    <div class="row"><div><strong>Morning routine feilet</strong></div><div class="badge fail">fail</div></div>
    <div class="muted" id="incident_text" style="margin-top:6px">—</div>
    <div class="muted" style="margin-top:8px"><a href="/api/runs?kind=morning_routine&limit=20" target="_blank">Se run-logg</a></div>
  </section>

  <section class="card">
    <h2>Status</h2>
    <div class="row"><div>Siste morning routine</div><div id="mr">…</div></div>
    <div class="muted" id="mr_summary" style="margin-top:-2px">&nbsp;</div>
    <div class="row" style="margin-top:10px"><div>Siste dashboard build</div><div id="dr">…</div></div>
    <div class="muted" id="dr_summary" style="margin-top:-2px">&nbsp;</div>
    <div class="row"><div>LAFT store batch</div><div class="pill"><span class="dot" style="background:var(--accent)"></span>Tor 15:00</div></div>
    <div class="row"><a href="https://github.com/henrbren/ai-ops/issues/2" target="_blank">Rapporter (issue #2)</a><span></span></div>
  </section>

  <section class="card" id="runs_card">
    <h2>Runs</h2>
    <div class="muted" style="margin:-4px 0 10px 0">Siste kjøringer fra <code>mimir.runs</code></div>
    <div class="row" style="margin:-2px 0 10px 0">
      <div class="muted">Filter</div>
      <select id="runs_kind" aria-label="Runs filter">
        <option value="">Alle</option>
      </select>
    </div>
    <div id="runs" class="muted">Laster…</div>
  </section>

  <section class="card">
    <h2>GitHub</h2>
    <div class="row"><div>Open PRs</div><div id="gh_prs">…</div></div>
    <div class="row"><div>PRs w/ failing checks</div><div id="gh_fail">…</div></div>
    <div class="row"><div>release:queued</div><div id="gh_rel">…</div></div>
    <div class="muted" id="gh_meta"></div>
  </section>

  <section class="card" id="leads_card">
    <h2>Leads</h2>
    <div class="muted" style="margin:-4px 0 10px 0">En enkel shell rundt <code>mimir.leads</code> (ingen ingestion ennå)</div>
    <div id="leads" class="muted">Laster…</div>
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

<div class="modal" id="run_modal" aria-hidden="true">
  <div class="box">
    <div class="top">
      <div>
        <div style="font-weight:600" id="run_modal_title">Run</div>
        <div class="muted" id="run_modal_meta">—</div>
      </div>
      <button class="btn" id="run_modal_close" type="button">Lukk</button>
    </div>
    <div class="muted" id="run_modal_summary" style="margin:-2px 0 10px 0">&nbsp;</div>
    <pre id="run_modal_details">{}</pre>
  </div>
</div>

<script>
  document.getElementById('now').textContent = new Date().toLocaleString('no-NO');
  function esc(s){
    return String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  }

  function selectedRunsKind(){
    const sel = document.getElementById('runs_kind');
    return sel ? String(sel.value || '') : '';
  }

  function fmtDurationMs(ms){
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return ms + 'ms';
    const s = Math.round(ms/1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s/60);
    const rs = s % 60;
    return m + 'm ' + String(rs).padStart(2,'0') + 's';
  }

  function openRunModal(run){
    const modal = document.getElementById('run_modal');
    if (!modal) return;

    const title = document.getElementById('run_modal_title');
    const meta = document.getElementById('run_modal_meta');
    const summary = document.getElementById('run_modal_summary');
    const details = document.getElementById('run_modal_details');

    title.textContent = (run.kind || 'run') + (run.id ? (' #' + run.id) : '');
    const started = run.started_at ? new Date(run.started_at) : null;
    const finished = run.finished_at ? new Date(run.finished_at) : null;
    const dur = (started && finished) ? fmtDurationMs(finished.getTime() - started.getTime()) : '';

    meta.textContent = [
      started ? started.toLocaleString('no-NO') : null,
      run.status ? String(run.status) : null,
      dur ? ('duration ' + dur) : null
    ].filter(Boolean).join(' · ');

    if (run.summary) {
      summary.textContent = run.summary;
    } else {
      summary.innerHTML = '&nbsp;';
    }

    try {
      details.textContent = JSON.stringify(run.details || {}, null, 2);
    } catch {
      details.textContent = String(run.details || '{}');
    }

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden','false');
  }

  function closeRunModal(){
    const modal = document.getElementById('run_modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden','true');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRunModal();
  });

  async function loadRuns(){
    const kind = selectedRunsKind();
    const url = kind ? ('/api/runs?kind=' + encodeURIComponent(kind) + '&limit=12') : '/api/runs?limit=12';
    const r = await fetch(url);
    const j = await r.json();
    const el = document.getElementById('runs');
    if (!Array.isArray(j?.runs) || j.runs.length === 0) {
      el.textContent = kind ? ('Ingen runs for ' + kind + ' ennå.') : 'Ingen runs ennå.';
      return;
    }

    el.classList.remove('muted');
    el.classList.add('runs');

    el.innerHTML = j.runs.map(run => {
      const when = new Date(run.started_at).toLocaleString('no-NO');
      const badge = '<span class="badge ' + esc(run.status) + '">' + esc(run.status) + '</span>';
      const summary = run.summary ? '<div class="muted">' + esc(run.summary) + '</div>' : '';
      const started = new Date(run.started_at);
      const finished = run.finished_at ? new Date(run.finished_at) : null;
      const dur = finished ? fmtDurationMs(finished.getTime() - started.getTime()) : '';
      const durEl = dur ? '<div class="muted">' + esc(dur) + '</div>' : '';
      return (
        '<div class="run clickable" data-run-id="' + esc(run.id) + '">' +
          '<div class="left">' +
            '<div><code>' + esc(run.kind) + '</code> · <span class="muted">' + esc(when) + '</span></div>' +
            summary +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' + badge + durEl + '</div>' +
        '</div>'
      );
    }).join('');

    // Click to view details
    for (const row of el.querySelectorAll('[data-run-id]')) {
      row.addEventListener('click', async () => {
        const id = row.getAttribute('data-run-id');
        if (!id) return;
        const rr = await fetch('/api/run/' + encodeURIComponent(id));
        const jj = await rr.json();
        if (jj?.run) openRunModal(jj.run);
      });
    }
  }

  async function loadLeads(){
    const r = await fetch('/api/leads?limit=8');
    const j = await r.json();
    const el = document.getElementById('leads');
    if (!Array.isArray(j?.leads) || j.leads.length === 0) {
      el.textContent = 'Ingen leads ennå.';
      return;
    }

    el.classList.remove('muted');
    el.classList.add('runs');

    el.innerHTML = j.leads.map(l => {
      const when = new Date(l.created_at).toLocaleString('no-NO');
      const right = '<span class="badge">' + esc(l.status || '—') + '</span>';
      const line2 = [l.company, l.email, l.source].filter(Boolean).join(' · ');
      const sub = line2 ? '<div class="muted">' + esc(line2) + '</div>' : '';
      return (
        '<div class="run">' +
          '<div class="left">' +
            '<div>' + (l.name ? esc(l.name) : '<span class="muted">(navn mangler)</span>') + ' · <span class="muted">' + esc(when) + '</span></div>' +
            sub +
          '</div>' +
          '<div>' + right + '</div>' +
        '</div>'
      );
    }).join('');
  }

  async function loadRunKinds(){
    const sel = document.getElementById('runs_kind');
    if (!sel) return;

    // Keep current selection, use localStorage once.
    const saved = localStorage.getItem('runs_kind') || '';
    if (!sel.value && saved) sel.value = saved;

    const r = await fetch('/api/run-kinds');
    const j = await r.json();
    const kinds = Array.isArray(j?.kinds) ? j.kinds : [];

    const current = sel.value;
    const existing = new Set(Array.from(sel.querySelectorAll('option')).map(o => o.value));
    for (const k of kinds) {
      if (!k || existing.has(k)) continue;
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    }
    sel.value = current;

    sel.onchange = () => {
      localStorage.setItem('runs_kind', sel.value || '');
      loadRuns().catch(()=>{});
    };
  }

  // Modal close wiring
  const runModal = document.getElementById('run_modal');
  const runModalClose = document.getElementById('run_modal_close');
  if (runModalClose) runModalClose.onclick = () => closeRunModal();
  if (runModal) {
    runModal.addEventListener('click', (e) => {
      if (e.target === runModal) closeRunModal();
    });
  }

  async function load(){

    const r = await fetch('/api/status');
    const j = await r.json();
    const mrEl = document.getElementById('mr');
    const mrSummaryEl = document.getElementById('mr_summary');
    const drSummaryEl = document.getElementById('dr_summary');

    mrEl.textContent = j.morningRoutine || '—';

    // Summary + duration (if finished_at present)
    const mrRun = j.morningRoutineRun;
    const mrSummary = mrRun?.summary ? String(mrRun.summary) : '';
    const mrStarted = mrRun?.started_at ? new Date(mrRun.started_at) : null;
    const mrFinished = mrRun?.finished_at ? new Date(mrRun.finished_at) : null;
    const mrDur = (mrStarted && mrFinished) ? fmtDurationMs(mrFinished.getTime() - mrStarted.getTime()) : '';

    if (mrSummary || mrDur) {
      mrSummaryEl.textContent = [mrSummary || null, mrDur ? ('duration ' + mrDur) : null].filter(Boolean).join(' · ');
    } else {
      mrSummaryEl.innerHTML = '&nbsp;';
    }

    const drRun = j.dashboardDailyRun;
    const drSummary = drRun?.summary ? String(drRun.summary) : '';
    const drStarted = drRun?.started_at ? new Date(drRun.started_at) : null;
    const drFinished = drRun?.finished_at ? new Date(drRun.finished_at) : null;
    const drDur = (drStarted && drFinished) ? fmtDurationMs(drFinished.getTime() - drStarted.getTime()) : '';

    if (drSummaryEl) {
      if (drSummary || drDur) {
        drSummaryEl.textContent = [drSummary || null, drDur ? ('duration ' + drDur) : null].filter(Boolean).join(' · ');
      } else {
        drSummaryEl.innerHTML = '&nbsp;';
      }
    }

    // Incident banner if latest morning routine failed
    const incidentEl = document.getElementById('incident');
    const incidentTextEl = document.getElementById('incident_text');
    const mrStatus = String(j.morningRoutineRun?.status || '').toLowerCase();
    if (mrStatus === 'fail') {
      const when = j.morningRoutineRun?.started_at ? new Date(j.morningRoutineRun.started_at).toLocaleString('no-NO') : '';
      const summary = j.morningRoutineRun?.summary ? j.morningRoutineRun.summary : '(ingen summary)';
      incidentTextEl.textContent = (when ? when + ' · ' : '') + summary;
      incidentEl.style.display = '';
    } else {
      incidentEl.style.display = 'none';
    }

    document.getElementById('dr').textContent = j.dashboardDaily || '—';

    if (j.github) {
      document.getElementById('gh_prs').textContent = String(j.github.open_prs ?? '—');
      document.getElementById('gh_fail').textContent = String(j.github.prs_with_failing_checks ?? '—');
      document.getElementById('gh_rel').textContent = String(j.github.release_queued_items ?? '—');
      document.getElementById('gh_meta').textContent = 'Sist oppdatert: ' + new Date(j.github.fetched_at).toLocaleString('no-NO');
    }

    loadRunKinds().catch(()=>{});
    loadRuns().catch(()=>{});
    loadLeads().catch(()=>{});

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
      `select started_at, finished_at, status, summary from mimir.runs where kind='morning_routine' order by started_at desc limit 1`
    );
    const dr = await client.query(
      `select started_at, finished_at, status, summary from mimir.runs where kind='dashboard_daily' order by started_at desc limit 1`
    );
    const gh = await client.query(
      `select fetched_at, open_prs, prs_with_failing_checks, release_queued_items from mimir.dashboard_github_stats order by fetched_at desc limit 1`
    );

    const fmt = (row) => row ? `${new Date(row.started_at).toLocaleString('no-NO')} · ${row.status}` : null;

    res.json({
      morningRoutine: mr.rows[0] ? fmt(mr.rows[0]) : null,
      dashboardDaily: dr.rows[0] ? fmt(dr.rows[0]) : null,
      morningRoutineRun: mr.rows[0] || null,
      dashboardDailyRun: dr.rows[0] || null,
      github: gh.rows[0] || null
    });
  } finally {
    client.release();
  }
});

app.get('/api/run-kinds', async (_req, res) => {
  const client = await pool.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`select distinct kind from mimir.runs order by kind asc`);
    res.json({ kinds: r.rows.map(x => x.kind) });
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

app.get('/api/run/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureSchema(client);

    const idRaw = String(req.params.id || '');
    const id = Number(idRaw);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const r = await client.query(
      `select id, kind, status, started_at, finished_at, summary, details
       from mimir.runs
       where id=$1`,
      [id]
    );

    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });

    res.json({ run: r.rows[0] });
  } finally {
    client.release();
  }
});

app.get('/api/leads', async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureSchema(client);

    const limitRaw = req.query.limit ? Number(req.query.limit) : 20;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 100) : 20;

    const r = await client.query(
      `select id, created_at, source, name, email, company, status, notes
       from mimir.leads
       order by created_at desc
       limit $1`,
      [limit]
    );

    res.json({ leads: r.rows });
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
