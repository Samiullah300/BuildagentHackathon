const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const AGENT37_URL = process.env.AGENT37_URL;
const AGENT37_KEY = process.env.AGENT37_KEY;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Database ----------------------------------------------------------
const isLocal = (process.env.DATABASE_URL || '').match(/localhost|127\.0\.0\.1/);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS commitments (
      id SERIAL PRIMARY KEY,
      task TEXT NOT NULL,
      owner VARCHAR(255) NOT NULL,
      due_date DATE,
      source_text TEXT,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );
  `);
  console.log('DB ready');
}

const asyncRoute = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

// ---- Agent37 extraction -------------------------------------------------
function extractText(data) {
  if (typeof data === 'string') return data;
  if (data.output_text) return data.output_text;
  if (Array.isArray(data.output)) {
    return data.output
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === 'output_text' || c.type === 'text')
      .map((c) => c.text)
      .join('');
  }
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  return '';
}

function parseCommitments(raw) {
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  let arr;
  try {
    arr = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => c && typeof c.task === 'string' && c.task.trim())
    .map((c) => ({
      task: c.task.trim(),
      owner: String(c.owner || 'you').trim() || 'you',
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(c.due_date) ? c.due_date : null,
      source_text: String(c.source_text || '').slice(0, 1000),
    }));
}

// ---- Routes -------------------------------------------------------------
app.get('/health', (req, res) => res.json({ ok: true, service: 'follow-up-ghost' }));

app.post('/api/extract', asyncRoute(async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (!AGENT37_URL || !AGENT37_KEY) {
    return res.status(500).json({ error: 'AGENT37_URL / AGENT37_KEY not configured' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are a commitment extraction engine. Today's date is ${today}.
Extract every actionable commitment (something someone promised or was asked to do) from the text below.
Return ONLY a JSON array, no markdown, no commentary. Each element:
{"task":"what must be done","owner":"who is responsible","due_date":"YYYY-MM-DD or null","source_text":"the exact snippet it came from"}
Rules:
- Resolve relative dates ("by Thursday", "EOD Friday", "next week") against ${today}.
- If the commitment is directed at the reader, owner is "you".
- If there are no commitments, return [].

TEXT:
"""
${text}
"""`;

  const r = await fetch(`${AGENT37_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      'X-Agent37-Key': AGENT37_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: prompt, model: 'gpt-4o-mini' }),
  });
  if (!r.ok) {
    const body = await r.text();
    return res.status(502).json({ error: `Agent37 ${r.status}: ${body.slice(0, 300)}` });
  }

  const commitments = parseCommitments(extractText(await r.json()));
  const inserted = [];
  for (const c of commitments) {
    const { rows } = await pool.query(
      `INSERT INTO commitments (task, owner, due_date, source_text)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [c.task, c.owner, c.due_date, c.source_text]
    );
    inserted.push(rows[0]);
  }
  res.json({ extracted: inserted.length, commitments: inserted });
}));

app.get('/api/commitments', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM commitments
     ORDER BY (status = 'completed'), due_date ASC NULLS LAST, created_at DESC`
  );
  res.json(rows);
}));

app.get('/api/commitments/due', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM commitments
     WHERE status = 'pending'
       AND due_date IS NOT NULL
       AND due_date <= CURRENT_DATE + INTERVAL '3 days'
     ORDER BY due_date ASC`
  );
  res.json(rows);
}));

app.post('/api/commitments/:id/complete', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE commitments SET status = 'completed', completed_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

app.delete('/api/commitments/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM commitments WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true });
}));

app.get('/api/stats', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'pending' AND due_date < CURRENT_DATE)::int AS overdue,
      COUNT(*) FILTER (WHERE status = 'pending'
        AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days')::int AS due_soon
    FROM commitments
  `);
  res.json(rows[0]);
}));

// Hit daily by the Agent37 cron job — returns everything that needs a nudge.
app.post('/api/nudge-check', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, task, owner, due_date,
            (due_date < CURRENT_DATE) AS overdue
     FROM commitments
     WHERE status = 'pending' AND due_date <= CURRENT_DATE + INTERVAL '1 day'
     ORDER BY due_date ASC`
  );
  console.log(`[nudge] ${rows.length} commitment(s) need follow-up`);
  res.json({ nudges: rows.length, commitments: rows });
}));

// ---- Boot ---------------------------------------------------------------
initDb()
  .then(() => app.listen(PORT, () => console.log(`Follow-Up Ghost on :${PORT}`)))
  .catch((e) => {
    console.error('DB init failed:', e.message);
    process.exit(1);
  });
