# 🐱 Cat Lobby

A real-time multiplayer cat lobby game with digging, trading, and persistent accounts.

---

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your settings (see below)
node server.js
# Open http://localhost:3000
```

---

## Setup: .env Configuration

Copy `.env.example` to `.env` and fill in the values:

```
PORT=3000
APP_URL=http://localhost:3000
JWT_SECRET=some-long-random-secret-here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@gmail.com
SMTP_PASS=your-gmail-app-password
EMAIL_FROM="Cat Lobby <your@gmail.com>"
DB_PATH=./catlobby.db
```

### Email Setup (Gmail)

1. Enable **2-Step Verification** on your Google account
2. Go to: myaccount.google.com → Security → **App Passwords**
3. Create an App Password for "Mail"
4. Use that 16-character password as `SMTP_PASS`

> **Dev tip:** If SMTP isn't configured, the server still works — it prints the verification URL to the console so you can verify accounts manually during development.

---

## Features

- **Guest Play** — Pick a name and join instantly, no account needed
- **Sign Up** — Email + password account with email verification
- **Sign In** — Persistent sessions via JWT (stored in localStorage), auto-login on return
- **Save Guest Progress** — A "Login / Sign Up" banner shows for guests; signing up mid-session merges all coins and items from that session into the new account
- **Auto-save** — Authenticated players' data saves to SQLite every 30 seconds and on disconnect
- **Profiles, Trading, Digging** — Full multiplayer features

---

## Database

Uses **SQLite** via `better-sqlite3`. The database file is created automatically at the path in `DB_PATH` (default: `./catlobby.db`). No setup needed.

---

## Hosting

### Render.com (easiest)
1. Push to GitHub
2. New Web Service → connect repo
3. Set environment variables in Render dashboard
4. Deploy

### Railway / Fly.io
Both auto-detect Node.js. Set env vars in their dashboard.

**Note:** For production, set `NODE_ENV=production` and use a persistent disk for the SQLite database file.
