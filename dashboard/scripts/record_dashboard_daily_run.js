import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/mimir_control'
});

async function ensureSchema(client) {
  await client.query(`create schema if not exists mimir`);
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
}

const status = process.argv[2] || 'ok';
const summary = process.argv[3] || 'dashboard_daily: show duration for latest runs in Status card';

const details = {
  feature: process.argv[4] || 'status_run_duration',
  repo: 'henrbren/ai-ops',
  component: 'dashboard',
  notes: process.argv[5] || 'Adds duration (if finished_at exists) for latest morning_routine and dashboard_daily in the Status card.'
};

const main = async () => {
  const client = await pool.connect();
  try {
    await ensureSchema(client);

    const ins = await client.query(
      `insert into mimir.runs(kind, status, finished_at, summary, details)
       values ('dashboard_daily', $1, now(), $2, $3)
       returning id`,
      [status, summary, details]
    );

    console.log(String(ins.rows[0].id));
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
