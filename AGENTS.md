# Follow-Up Ghost — AI Commitment Tracker

> Never drop a commitment again. An AI agent that tracks what you owe and what others owe you.

## Project Overview

**Follow-Up Ghost** solves the universal problem of forgotten commitments. Paste any email, message, or meeting note, and the AI extracts actionable commitments with owners and deadlines, then tracks them until completion — and **emails you before they're due**.

### The Pain Point

From r/productivity research:
- *"How do you keep track of things you need to follow up on?"*
- *"Do you also forget what you worked on yesterday?"*
- *"Manual data entry and 'just checking in' emails drain rep energy"*

People constantly make commitments in messages but lose track of them, causing anxiety, dropped balls, and damaged relationships.

### Solution

A web app where users:
1. **Paste any text** (email, message, meeting notes)
2. **AI extracts commitments** — task, owner, owner email, due date
3. **Track in dashboard** — see pending, due soon, completed
4. **Get nudged by email** — a daily agent emails reminders before deadlines

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User Input    │────▶│  InstaCloud      │────▶│  Agent37        │
│  (Web Form)     │     │  compute + pg    │     │  (Hermes)       │
└─────────────────┘     │                  │     │  donch9fjsj     │
                        │  - Node.js API   │     └─────────────────┘
                        │  - Postgres DB   │              │
                        │  - Static site   │              ▼
                        └──────────────────┘     ┌─────────────────┐
                                 │               │  Extract: task, │
                                 ▼               │  owner, email,  │
                        ┌──────────────────┐     │  due_date       │
                        │ InstaCloud Cron  │     └─────────────────┘
                        │ daily 13:00 UTC  │
                        │ POST /api/       │     ┌─────────────────┐
                        │  nudge-check     │────▶│  Agent37 agent  │
                        └──────────────────┘     │  drafts + sends │
                                               │  via AgentMail  │
                                               │  (Monid)        │
                                               └─────────────────┘
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | HTML/CSS/JS | User interface |
| **Backend** | Node.js + Express | REST API |
| **Database** | PostgreSQL (InstaCloud) | Store commitments |
| **AI/LLM** | Agent37 Hermes (GPT-4o-mini) | Extraction + nudge email agent |
| **Hosting** | InstaCloud | Compute + cron scheduling |
| **Email/Video** | Monid (AgentMail, video gen, sfs hosting) | Nudge emails + demo video |

## Sponsor Integrations

This project uses **3 sponsors** (exceeds requirement of Agent37 + 1):

| Sponsor | Usage |
|---------|-------|
| **Agent37** | Hermes instance for AI commitment extraction + the nudge-email agent |
| **InstaCloud** | Compute hosting, PostgreSQL database, daily cron scheduler |
| **Monid** | AgentMail nudge emails, AI demo-video generation, sfs video hosting |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/extract` | Extract commitments from text (optional `default_email`) |
| `GET` | `/api/commitments` | List all commitments |
| `GET` | `/api/commitments/due` | Get due-soon commitments |
| `POST` | `/api/commitments/:id/complete` | Mark complete |
| `DELETE` | `/api/commitments/:id` | Delete commitment |
| `GET` | `/api/stats` | Get statistics |
| `GET` | `/api/insights` | Completion rate, nudges sent, most-tracked owner |
| `POST` | `/api/nudge-check` | Cron: Agent37 drafts + sends nudge emails (idempotent) |
| `POST` | `/api/check-inbox` | Cron: poll inbox → extract commitments / close on reply |

## Database Schema

```sql
CREATE TABLE commitments (
  id SERIAL PRIMARY KEY,
  task TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  owner_email VARCHAR(320),
  due_date DATE,
  source_text TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);
```

Schema changes are tracked as files in `migrations/` (InstaCloud never merges databases — only migration files carry schema forward).

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes (bound from `postgres/main-db`) |
| `AGENT37_URL` | Agent37 instance URL | Yes (`https://donch9fjsj.agent37.app`) |
| `AGENT37_KEY` | Agent37 API key | Yes |
| `AGENTMAIL_KEY` | AgentMail API key | Yes (for send + inbox polling) |
| `AGENTMAIL_INBOX` | Ghost's inbox address | Yes (`samiullah-4993@agentmail.to`) |
| `NOTIFY_EMAIL` | Default nudge recipient | No (default: samiullah1yousufi@gmail.com) |
| `PORT` | Server port | No (default: 3000) |

## Local Development

```bash
# Install dependencies
npm install

# Run with the InstaCloud branch bundle injected (nothing written to disk)
insta --agent run -- npm start
```

## Deployment

Live at **https://prod-main-api-b00c6a-00gs2zr35ce.compute.instacloud-edge.com**

```bash
insta --agent deploy . --port 3000   # build + deploy to branch main, group api
```

Daily cron: `insta --agent cron list` → `daily-nudge` (`0 13 * * *` UTC → POST `/api/nudge-check` on service `api`).

## File Structure

```
follow-up-ghost/
├── server.js              # Express server + API routes
├── package.json           # Dependencies (+ `npm run monid` wrapper)
├── Dockerfile             # Container configuration
├── migrations/            # Tracked schema changes (001_owner_email.sql)
├── scripts/monid-run.sh   # Lets Agent37's sandbox call Monid via npm run monid
├── public/
│   └── index.html         # Frontend UI
├── .insta/
│   └── project.json       # InstaCloud project binding
└── AGENTS.md              # This file
```

## Key Implementation Details

### Agent37 Integration

The app calls the Agent37 Hermes instance for commitment extraction:

```javascript
const response = await fetch(`${AGENT37_URL}/v1/responses`, {
  method: 'POST',
  headers: { 'X-Agent37-Key': AGENT37_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: prompt, model: 'gpt-4o-mini' })
});
```

### Commitment Extraction Prompt

The AI is prompted to extract a **JSON array** (one message usually holds several commitments):
- **task**: What needs to be done
- **owner**: Who is responsible (`"you"` when directed at the reader)
- **owner_email**: Email address if mentioned
- **due_date**: YYYY-MM-DD, relative dates resolved against today
- **source_text**: Original text snippet

### The Autonomous Loop (live)

The ghost is a fully autonomous agent — **sense → decide → act → verify**:

1. **Sense (email-in):** InstaCloud cron `inbox-poll` (`*/15 * * * *`) POSTs `/api/check-inbox` → server lists unread mail at the ghost's AgentMail inbox (`samiullah-4993@agentmail.to`, display name "Follow-Up Ghost") → Agent37 extracts commitments from each new message (deduped via the `seen_messages` table). **Forward any email to that address and its commitments appear on the dashboard within 15 minutes.**
2. **Decide + Act (nudges):** InstaCloud cron `daily-nudge` (`0 13 * * *`) POSTs `/api/nudge-check` → for every due/overdue commitment not already nudged today, **Agent37 drafts a personal reminder email** (subject starts "Reminder: …") and the server sends it through AgentMail (`POST /v0/inboxes/{id}/messages/send`), then stamps `nudged_at`/`nudge_count` so it never double-sends.
3. **Verify (reply-to-close):** When someone replies `Re: Reminder: <task>` with "done", the next `inbox-poll` run matches the subject to the open commitment, Agent37 classifies the intent, and the commitment is auto-completed. **Zero manual clicks.**

Env: `AGENTMAIL_KEY` + `AGENTMAIL_INBOX` secrets (bound to compute). `NOTIFY_EMAIL` is the fallback recipient when a commitment has no owner email.

### Demo Video (Monid)

The 2-minute demo video is AI-generated through Monid (Kling text-to-video + ElevenLabs ghost-voice narration) and hosted via Monid **sfs** (`/put` + `/cat`, 7-day signed URL) — link is in the submission.

### Demo Flow

1. User pastes: *"Can you send me the Q3 report by Thursday?"* + their email
2. AI extracts: `{task: "Send Q3 report", owner: "you", due_date: "2026-10-08"}`
3. Stored in Postgres, displayed in dashboard
4. Next morning the cron fires, the agent emails: *"Reminder: Send Q3 report is due today"*

## Hackathon Submission

**Event**: "Build an Agent" Hackathon  
**Theme**: Replace your most annoying workflow  
**Author**: Samiullah Yousufi (solo)  
**Live URL**: https://prod-main-api-b00c6a-00gs2zr35ce.compute.instacloud-edge.com  
**Repo**: https://github.com/Samiullah300/BuildagentHackathon

### Submission Checklist

- [x] Working demo video (2 min) — generated + hosted via Monid
- [x] Live URL on InstaCloud
- [x] GitHub repository
- [x] Uses Agent37 Cloud APIs
- [x] Uses 2+ additional sponsors (InstaCloud, Monid)
- [x] Clear workflow replacement description
- [x] Demo video shows end-to-end flow

## Future Enhancements

- [ ] Email auto-import (AgentMail inbound webhook)
- [ ] Smart nudge timing (ML-based)
- [ ] Team workspaces
- [ ] Mobile app
- [ ] Analytics dashboard
- [ ] Calendar sync

## License

MIT

---

**Built with ❤️ for the "Build an Agent" Hackathon**

