# Goodminton 🏸

A lightweight weekly badminton attendance tracker. Players mark themselves **In** or **Out** for the upcoming session via a simple mobile-friendly page — no login required. Admins manage teams, players, and schedules through a password-protected panel.

## Features

### Player-facing team page (`/t/:slug`)
- One-tap **In / Out** registration for the upcoming session
- Live count of confirmed players vs. the minimum needed
- **Game on** banner when enough players have confirmed
- **Response log** — timestamped record of who registered In or Out
- **Season attendance** — each player's play count for the current season
- **Vacation registration** — players can block out date ranges in advance; sessions that fall within a vacation window are automatically marked Out
- Collapsible **team description**
- Auto-refreshes every 30 seconds

### Admin panel (`/admin`)
- **Teams** — create and manage multiple teams, each with its own schedule, season dates, location, minimum player count, and reminder timing
- **Player inventory** — centralized player list; add a player once and assign them to any number of teams without re-entering their details
- **Regular vs. backup players** — backup players appear in a separate section on the team page and are excluded from email/SMS reminders; their responses still count toward the session total
- **Session history** — per-team log of past sessions with In/Out/pending counts; click any session to see a timestamped response log
- **Season attendance log** — per-player play counts for the current season
- **Vacation management** — view and delete vacation periods for any player

### Reminders
- Automatic **email** reminders via [Resend](https://resend.com) (free tier: 3,000 emails/month)
- Automatic **SMS** reminders via [Twilio](https://twilio.com)
- Reminder timing is configurable per team (e.g. 24 hours before game time)
- Only **regular** players receive reminders — backup players are always skipped
- Each player is notified at most once per session

## Tech stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express |
| Database | SQLite via `better-sqlite3` |
| Email | Resend |
| SMS | Twilio |
| Frontend | Vanilla HTML/CSS/JS (no build step) |

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/iar42/goodminton.git
cd goodminton
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```
ADMIN_PASSWORD=your-secure-password
SESSION_SECRET=a-long-random-string
```

Email and SMS keys are optional — leave them blank to disable those reminder channels.

### 3. Run

```bash
npm start
```

The app starts on [http://localhost:3000](http://localhost:3000).

- **Admin panel:** http://localhost:3000/admin
- **Team page:** http://localhost:3000/t/`<slug>` (slug is set when creating a team)

## Project structure

```
├── server.js            # Express app entry point
├── database.js          # SQLite schema + migrations
├── routes/
│   ├── admin.js         # Admin API (teams, players, inventory, sessions)
│   └── team.js          # Player-facing API (session, responses, vacations)
├── services/
│   ├── scheduler.js     # Cron job that fires reminders
│   ├── email.js         # Resend email helper
│   └── sms.js           # Twilio SMS helper
├── utils/
│   └── session.js       # Date helpers (next session date, season check)
└── public/
    ├── team.html        # Player-facing SPA
    └── admin.html       # Admin SPA
```

## Deploying

The app runs on any Node.js host. [Railway](https://railway.app) is a good zero-config option:

1. Push to GitHub
2. Create a new Railway project → **Deploy from GitHub repo**
3. Add the environment variables from `.env.example`
4. Railway provides a public URL automatically

The SQLite database is stored in `data/badminton.db` — make sure that path is on a persistent volume in production.
