import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 8787;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/mimir_control'
});

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
  async function load(){
    const r = await fetch('/api/status');
    const j = await r.json();
    document.getElementById('mr').textContent = j.morningRoutine || '—';
    document.getElementById('dr').textContent = j.dashboardDaily || '—';
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
    const mr = await client.query(
      `select started_at, status from mimir.runs where kind='morning_routine' order by started_at desc limit 1`
    );
    const dr = await client.query(
      `select started_at, status from mimir.runs where kind='dashboard_daily' order by started_at desc limit 1`
    );

    const fmt = (row) => row ? `${new Date(row.started_at).toLocaleString('no-NO')} · ${row.status}` : null;

    res.json({
      morningRoutine: mr.rows[0] ? fmt(mr.rows[0]) : null,
      dashboardDaily: dr.rows[0] ? fmt(dr.rows[0]) : null
    });
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  console.log(`Dashboard running on http://localhost:${port}`);
});
