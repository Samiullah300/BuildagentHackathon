const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const AGENT37_URL = process.env.AGENT37_URL;
const AGENT37_KEY = process.env.AGENT37_KEY;
const AGENTMAIL_KEY = process.env.AGENTMAIL_KEY;
const AGENTMAIL_INBOX = process.env.AGENTMAIL_INBOX || 'samiullah-4993@agentmail.to';
const APP_URL = process.env.APP_URL || '';

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
  await pool.query(
    `ALTER TABLE commitments ADD COLUMN IF NOT EXISTS owner_email VARCHAR(320)`
  );
  await pool.query(
    `ALTER TABLE commitments ADD COLUMN IF NOT EXISTS nudged_at TIMESTAMP`
  );
  await pool.query(
    `ALTER TABLE commitments ADD COLUMN IF NOT EXISTS nudge_count INT DEFAULT 0`
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seen_messages (
      message_id TEXT PRIMARY KEY,
      processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
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
      owner_email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.owner_email || '')
        ? c.owner_email
        : null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(c.due_date) ? c.due_date : null,
      source_text: String(c.source_text || '').slice(0, 1000),
    }));
}

// ---- Agent37 + AgentMail helpers ----------------------------------------
async function askAgent(prompt) {
  const r = await fetch(`${AGENT37_URL}/v1/responses`, {
    method: 'POST',
    headers: { 'X-Agent37-Key': AGENT37_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: prompt, model: 'gpt-4o-mini' }),
  });
  if (!r.ok) throw new Error(`Agent37 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return extractText(await r.json());
}

function parseJsonObject(raw) {
  const cleaned = String(raw).replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendEmail({ to, subject, text }) {
  if (!AGENTMAIL_KEY) throw new Error('AGENTMAIL_KEY not configured');
  const r = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(AGENTMAIL_INBOX)}/messages/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${AGENTMAIL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: [to], subject, text }),
    }
  );
  if (!r.ok) throw new Error(`AgentMail ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function listUnreadMessages() {
  const r = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(AGENTMAIL_INBOX)}/messages?limit=20`,
    { headers: { Authorization: `Bearer ${AGENTMAIL_KEY}` } }
  );
  if (!r.ok) throw new Error(`AgentMail ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const { messages = [] } = await r.json();
  return messages.filter((m) => (m.labels || []).includes('received'));
}

// ---- Routes -------------------------------------------------------------
app.get('/health', (req, res) => res.json({ ok: true, service: 'follow-up-ghost' }));

app.post('/api/extract', asyncRoute(async (req, res) => {
  const { text, default_email: defaultEmail } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (!AGENT37_URL || !AGENT37_KEY) {
    return res.status(500).json({ error: 'AGENT37_URL / AGENT37_KEY not configured' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are a commitment extraction engine. Today's date is ${today}.
Extract every actionable commitment (something someone promised or was asked to do) from the text below.
Return ONLY a JSON array, no markdown, no commentary. Each element:
{"task":"what must be done","owner":"who is responsible","owner_email":"email address of the owner if mentioned, else null","due_date":"YYYY-MM-DD or null","source_text":"the exact snippet it came from"}
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
  const fallbackEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(defaultEmail || '')
    ? defaultEmail
    : null;
  const inserted = [];
  for (const c of commitments) {
    const { rows } = await pool.query(
      `INSERT INTO commitments (task, owner, owner_email, due_date, source_text)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [c.task, c.owner, c.owner_email || fallbackEmail, c.due_date, c.source_text]
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

// Hit daily by the InstaCloud cron job. For every due/overdue commitment the
// agent (Agent37) drafts a personal reminder email and the server sends it
// through AgentMail. Idempotent: at most one nudge per commitment per day.
app.post('/api/nudge-check', asyncRoute(async (req, res) => {
  const notifyEmail = process.env.NOTIFY_EMAIL || null;
  const { rows } = await pool.query(
    `SELECT id, task, owner, owner_email, due_date,
            (due_date < CURRENT_DATE) AS overdue
     FROM commitments
     WHERE status = 'pending' AND due_date <= CURRENT_DATE + INTERVAL '1 day'
       AND (nudged_at IS NULL OR nudged_at < CURRENT_DATE)
     ORDER BY due_date ASC`
  );

  const results = [];
  for (const c of rows) {
    const to = c.owner_email || notifyEmail;
    if (!to || !AGENTMAIL_KEY) {
      results.push({ id: c.id, sent: false, reason: 'no recipient' });
      continue;
    }
    const due = String(c.due_date).slice(0, 10);
    let email;
    try {
      const draftRaw = await askAgent(
        `You are Follow-Up Ghost, a friendly assistant that nudges people about commitments before they drop them.
Draft a short reminder email as STRICT JSON, no markdown: {"subject":"...","body":"..."}.
- Subject starts with "Reminder: ".
- Body: 2-3 sentences, warm but direct, plain text. Mention the task and the due date.
- Say they can reply "DONE" to close it, or see the dashboard${APP_URL ? ` at ${APP_URL}` : ''}.
- Sign off as "— Follow-Up Ghost 👻".
Commitment: task="${c.task}", owner="${c.owner}", due_date=${due}, overdue=${c.overdue}.`
      );
      email = parseJsonObject(draftRaw);
    } catch (e) {
      console.error(`[nudge] draft failed for #${c.id}:`, e.message);
    }
    if (!email || !email.subject || !email.body) {
      email = {
        subject: `Reminder: ${c.task}`,
        body: `Hi ${c.owner},\n\nThis is a friendly nudge: "${c.task}" is ${c.overdue ? 'overdue (was due ' + due + ')' : 'due ' + due}.\n\nReply "DONE" to close it${APP_URL ? `, or see the dashboard: ${APP_URL}` : ''}.\n\n— Follow-Up Ghost 👻`,
      };
    }
    try {
      await sendEmail({ to, subject: email.subject, text: email.body });
      await pool.query(
        `UPDATE commitments SET nudged_at = CURRENT_TIMESTAMP,
         nudge_count = COALESCE(nudge_count, 0) + 1 WHERE id = $1`,
        [c.id]
      );
      results.push({ id: c.id, sent: true, to, subject: email.subject });
      console.log(`[nudge] sent to ${to}: ${email.subject}`);
    } catch (e) {
      console.error(`[nudge] send failed for #${c.id}:`, e.message);
      results.push({ id: c.id, sent: false, reason: e.message });
    }
  }
  res.json({ nudges: rows.length, sent: results.filter((r) => r.sent).length, results });
}));

// Polled by the inbox-poll cron. Reads incoming email at the ghost's
// AgentMail inbox: replies to nudges ("DONE") auto-close commitments, and
// any other message is scanned for new commitments to track.
app.post('/api/check-inbox', asyncRoute(async (req, res) => {
  if (!AGENTMAIL_KEY) return res.status(500).json({ error: 'AGENTMAIL_KEY not configured' });
  const messages = await listUnreadMessages();
  let imported = 0;
  let closed = 0;
  const skipped = [];

  for (const m of messages) {
    const mid = m.message_id;
    const seen = await pool.query('SELECT 1 FROM seen_messages WHERE message_id = $1', [mid]);
    if (seen.rowCount) continue;

    const subject = m.subject || '';
    const from = m.from || '';
    const senderEmail = (from.match(EMAIL_RE) || from.match(/<([^>]+)>/) || [])[0] || null;
    const bodyText = [subject, m.preview || m.text || ''].join('\n').slice(0, 3000);

    // 1) Reply to one of our nudges? -> maybe close the commitment
    const reMatch = subject.match(/^re:\s*reminder:\s*(.+)$/i);
    if (reMatch) {
      const taskHint = reMatch[1].trim();
      const { rows: open } = await pool.query(
        `SELECT id, task FROM commitments
         WHERE status = 'pending' AND task ILIKE $1
         ORDER BY created_at DESC LIMIT 1`,
        [`%${taskHint.slice(0, 60)}%`]
      );
      if (open.length) {
        const verdict = parseJsonObject(await askAgent(
          `Someone received a reminder about the commitment "${open[0].task}" and replied.
Reply subject: "${subject}"
Reply preview: "${bodyText.slice(0, 500)}"
Did they say the commitment is done/completed? STRICT JSON: {"done": true|false}`
        ));
        if (verdict && verdict.done) {
          await pool.query(
            `UPDATE commitments SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [open[0].id]
          );
          closed++;
          console.log(`[inbox] closed #${open[0].id} via reply from ${senderEmail}`);
          await pool.query('INSERT INTO seen_messages (message_id) VALUES ($1) ON CONFLICT DO NOTHING', [mid]);
          continue;
        }
      }
    }

    // 2) Otherwise treat as new content -> extract commitments
    try {
      const today = new Date().toISOString().slice(0, 10);
      const raw = await askAgent(
        `You are a commitment extraction engine. Today's date is ${today}.
Extract every actionable commitment from the email below. Return ONLY a JSON array. Each element:
{"task":"...","owner":"who is responsible (\\"you\\" if directed at the reader)","owner_email":"email if mentioned else null","due_date":"YYYY-MM-DD or null","source_text":"exact snippet"}
If none, return [].
EMAIL:
"""
${bodyText}
"""`
      );
      const found = parseCommitments(raw);
      for (const c of found) {
        await pool.query(
          `INSERT INTO commitments (task, owner, owner_email, due_date, source_text)
           VALUES ($1, $2, $3, $4, $5)`,
          [c.task, c.owner, c.owner_email || senderEmail, c.due_date, `email: ${subject}`.slice(0, 1000)]
        );
        imported++;
      }
      if (!found.length) skipped.push(subject);
    } catch (e) {
      console.error(`[inbox] extract failed for "${subject}":`, e.message);
    }
    await pool.query('INSERT INTO seen_messages (message_id) VALUES ($1) ON CONFLICT DO NOTHING', [mid]);
  }
  res.json({ scanned: messages.length, imported, closed, skipped });
}));

// Insights for the dashboard + judges
app.get('/api/insights', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / NULLIF(COUNT(*), 0))::int AS completion_rate,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400)::numeric, 1) AS avg_days_to_close,
      (SELECT owner FROM commitments GROUP BY owner ORDER BY COUNT(*) DESC LIMIT 1) AS most_tracked_owner,
      COALESCE(SUM(nudge_count), 0)::int AS nudges_sent
    FROM commitments
  `);
  res.json(rows[0]);
}));

// ---- Boot ---------------------------------------------------------------
initDb()
  .then(() => app.listen(PORT, () => console.log(`Follow-Up Ghost on :${PORT}`)))
  .catch((e) => {
    console.error('DB init failed:', e.message);
    process.exit(1);
  });
