# Follow-Up Ghost — AI Commitment Tracker

> Never drop a commitment again. An AI agent that tracks what you owe and what others owe you.

## Project Overview

**Follow-Up Ghost** solves the universal problem of forgotten commitments. Paste any Slack message, email, or text, and the AI extracts actionable commitments with owners and deadlines, then tracks them until completion.

### The Pain Point

From r/productivity research:
- *"How do you keep track of things you need to follow up on?"*
- *"Do you also forget what you worked on yesterday?"*
- *"Manual data entry and 'just checking in' emails drain rep energy"*

People constantly make commitments in messages but lose track of them, causing anxiety, dropped balls, and damaged relationships.

### Solution

A web app where users:
1. **Paste any text** (Slack, email, meeting notes)
2. **AI extracts commitments** — task, owner, due date
3. **Track in dashboard** — see pending, due soon, completed
4. **Get nudged** — automated reminders before deadlines

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User Input    │────▶│  InstaCloud      │────▶│  Agent37        │
│  (Web Form)     │     │  (Free Tier)     │     │  (Hermes)       │
└─────────────────┘     │                  │     │  donch9fjsj     │
                        │  - Node.js API   │     └─────────────────┘
                        │  - Postgres DB   │              │
                        │  - Static site   │              ▼
                        └──────────────────┘     ┌─────────────────┐
                                 │               │  Extract:       │
                                 ▼               │  task, owner,   │
                        ┌──────────────────┐     │  due_date       │
                        │  Agent37 Cron    │     └─────────────────┘
                        │  (Daily nudge    │
                        │   checker)       │
                        └──────────────────┘
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | HTML/CSS/JS | User interface |
| **Backend** | Node.js + Express | REST API |
| **Database** | PostgreSQL (InstaCloud) | Store commitments |
| **AI/LLM** | Agent37 Hermes (GPT-4o-mini) | Commitment extraction |
| **Hosting** | InstaCloud | Free tier deployment |
| **Scheduler** | Agent37 Cron | Daily nudge checks |

## Sponsor Integrations

This project uses **3 sponsors** (exceeds requirement of Agent37 + 1):

| Sponsor | Usage |
|---------|-------|
| **Agent37** | Hermes instance for AI commitment extraction + scheduled cron jobs |
| **InstaCloud** | Hosting compute service + PostgreSQL database |
| **Monid** | Data research and market validation |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/extract` | Extract commitments from text |
| `GET` | `/api/commitments` | List all commitments |
| `GET` | `/api/commitments/due` | Get due-soon commitments |
| `POST` | `/api/commitments/:id/complete` | Mark complete |
| `DELETE` | `/api/commitments/:id` | Delete commitment |
| `GET` | `/api/stats` | Get statistics |

## Database Schema

```sql
CREATE TABLE commitments (
  id SERIAL PRIMARY KEY,
  task TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  due_date DATE,
  source_text TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes (auto-injected by InstaCloud) |
| `AGENT37_URL` | Agent37 instance URL | Yes |
| `AGENT37_KEY` | Agent37 API key | Yes |
| `PORT` | Server port | No (default: 3000) |

## Local Development

```bash
# Install dependencies
npm install

# Set environment variables
export DATABASE_URL="postgresql://..."
export AGENT37_URL="https://donch9fjsj.agent37.app"
export AGENT37_KEY="sk_live_..."

# Run server
npm start
```

## Deployment

This project is configured for **InstaCloud**:

```bash
# Login to InstaCloud
insta login

# Link project
insta project link follow-up-ghost

# Deploy
insta deploy .
```

## File Structure

```
follow-up-ghost/
├── server.js           # Express server + API routes
├── package.json        # Dependencies
├── Dockerfile          # Container configuration
├── public/
│   └── index.html      # Frontend UI
├── .insta/
│   └── project.json    # InstaCloud project binding
└── AGENTS.md           # This file
```

## Key Implementation Details

### Agent37 Integration

The app calls your Agent37 Hermes instance for commitment extraction:

```javascript
const response = await fetch(`${AGENT37_URL}/v1/responses`, {
  method: 'POST',
  headers: {
    'X-Agent37-Key': AGENT37_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    input: `Extract commitments from this text. Return JSON with fields: task, owner, due_date, source_text. Text: "${text}"`,
    model: 'gpt-4o-mini'
  })
});
```

### Commitment Extraction Prompt

The AI is prompted to extract structured data:
- **task**: What needs to be done
- **owner**: Who is responsible
- **due_date**: When it's due (YYYY-MM-DD)
- **source_text**: Original text snippet

### Demo Flow

1. User pastes: *"Can you send me the Q3 report by Thursday?"*
2. AI extracts: `{task: "Send Q3 report", owner: "you", due_date: "2026-10-08"}`
3. Stored in Postgres, displayed in dashboard
4. Cron job checks daily, highlights due items

## Hackathon Submission

**Event**: "Build an Agent" Hackathon  
**Theme**: Replace your most annoying workflow  
**Team**: [Your Team Name]  
**Live URL**: [Your InstaCloud URL]  
**Repo**: https://github.com/Samiullah300/BuildagentHackathon

### Submission Checklist

- [x] Working demo video (2 min)
- [x] Live URL on InstaCloud
- [x] GitHub repository
- [x] Uses Agent37 Cloud APIs
- [x] Uses 2+ additional sponsors (InstaCloud, Monid)
- [x] Clear workflow replacement description
- [x] Demo video shows end-to-end flow

## Future Enhancements

- [ ] Slack/Email integrations (auto-import)
- [ ] Smart nudge timing (ML-based)
- [ ] Team workspaces
- [ ] Mobile app
- [ ] Analytics dashboard
- [ ] Calendar sync

## License

MIT

---

**Built with ❤️ for the "Build an Agent" Hackathon**
