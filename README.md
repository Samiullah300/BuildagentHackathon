# Follow-Up Ghost 👻

> Never drop a commitment again. An autonomous AI agent that reads your email, tracks every promise, nudges you before it's due, and closes the loop when you reply **DONE**.

**Live:** https://prod-main-api-b00c6a-00gs2zr35ce.compute.instacloud-edge.com

## The workflow it replaces

Manually re-reading email to remember who promised what, writing awkward *"just checking in…"* reminders, and chasing people before deadlines. The ghost does all of that for you — zero manual tracking.

## The autonomous loop

```
sense ─────────────────▶ decide ────────────────▶ act ──────────────────▶ verify
forward any email      Agent37 extracts         Agent37 drafts a        reply "DONE"
to the ghost's inbox   who owes what,           personal nudge email,   to a nudge →
→ tracked on dashboard by when (owner, email,   sent before the         Agent37 reads it
                       due date)                deadline via AgentMail  → auto-closes it
```

1. **Email-in:** forward any email to `samiullah-4993@agentmail.to` — within 15 minutes its commitments appear on the dashboard (InstaCloud cron `inbox-poll` → Agent37 extraction).
2. **Nudges:** daily at 13:00 UTC (cron `daily-nudge`), for each due/overdue commitment Agent37 drafts a short personal reminder and the server sends it from the ghost's AgentMail inbox.
3. **Reply-to-close:** reply `Re: Reminder: <task>` with "done" — the next poll auto-completes the commitment. No clicks.

## Sponsors (3)

| Sponsor | Used for |
|---|---|
| **Agent37** | Hermes (GPT-4o-mini): commitment extraction, nudge-email drafting, reply-intent classification |
| **InstaCloud** | Node.js compute hosting, PostgreSQL, two cron schedulers |
| **Monid** | AgentMail email (the ghost's inbox), AI demo-video generation + sfs hosting |

## Quick start

```bash
npm install
cp .env.example .env   # fill DATABASE_URL, AGENT37_URL, AGENT37_KEY, AGENTMAIL_KEY
npm start              # http://localhost:3000
```

Deploy to InstaCloud:

```bash
insta --agent deploy . --port 3000
```

## API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/extract` | Extract commitments from pasted text |
| `GET` | `/api/commitments` | List all commitments |
| `POST` | `/api/nudge-check` | Cron: draft + send nudge emails |
| `POST` | `/api/check-inbox` | Cron: poll inbox → track / close |
| `GET` | `/api/insights` | Completion rate, nudges sent |

Full schema, cron setup and architecture in [AGENTS.md](AGENTS.md).

## License

MIT — built by Samiullah Yousufi for the "Build an Agent" Hackathon.
