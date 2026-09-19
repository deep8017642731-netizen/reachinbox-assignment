# ReachInbox Email Scheduler

A production-oriented full-stack email scheduler built for the **ReachInbox.ai / Outbox Labs Software Development Internship Assignment**.

Built with **TypeScript, Express.js, PostgreSQL, Prisma, Redis, BullMQ, Elasticsearch, React, Google OAuth, Slack OAuth and Ethereal SMTP**.

> Scheduling is handled by **BullMQ delayed jobs**. No cron-based scheduler is used.

---

## Features

### Backend
- TypeScript + Express.js REST API
- PostgreSQL + Prisma for persistent business state
- Redis + BullMQ delayed jobs
- Persistent jobs across server/container restarts
- Ethereal SMTP email delivery
- Multiple sender records
- Configurable worker concurrency
- Configurable minimum delay between sends
- Per-sender hourly rate limiting
- Atomic Redis rate-limit coordination across workers
- Rate-limited jobs are rescheduled, not dropped
- Idempotency / duplicate-send protection
- BullMQ retries with exponential backoff
- Google OAuth 2.0 authentication
- Slack OAuth 2.0 + rate-limit notifications
- Elasticsearch email indexing/search
- Bull Board queue monitoring
- 1000-recipient scheduling batches

### Frontend
- React + TypeScript
- Tailwind / modern responsive UI
- Google login/logout
- User name, email and avatar
- Compose email
- CSV/TXT recipient upload
- Recipient count preview
- Start time, delay and hourly-limit configuration
- Scheduled Emails dashboard
- Sent Emails dashboard
- Email status tracking

---

## Architecture

```text
                     React + TypeScript
                            │
                            ▼
                    Express.js API
                     │          │
              ┌──────┘          └──────┐
              ▼                        ▼
        PostgreSQL                   Redis
        + Prisma                  + BullMQ
              │                        │
              │                        ▼
              │                 Email Worker
              │                  │    │    │
              │                  ▼    ▼    ▼
              │              Ethereal ES  Slack
              │               SMTP Search Alerts
              │
              └──────── Source of Truth
## Infrastructure

| Component | Purpose |
|---|---|
| PostgreSQL | Users, senders, emails, Slack connections |
| Redis | BullMQ, delayed jobs, rate limiting, send-delay coordination |
| BullMQ | Persistent scheduling and job processing |
| Elasticsearch | Email search/index |
| Ethereal | Fake SMTP delivery |
| Slack | Rate-limit notifications |
| Bull Board | Queue monitoring |

##Project Structure
reachinbox-assignment/
├── backend/
│   ├── prisma/
│   ├── src/
│   │   ├── admin/
│   │   ├── auth/
│   │   ├── controllers/
│   │   ├── queues/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── validation/
│   │   └── workers/
│   ├── tests/
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   └── package.json
├── docker-compose.yml
├── package.json
└── README.md
Setup
Requirements
Node.js 20+
npm
Docker
Docker Compose
Git

Tested with Node.js 26.x, Docker 29.x and Docker Compose 5.x.

1. Start Infrastructure

From the project root:

docker compose up -d

This starts:

PostgreSQL
Redis
Elasticsearch

Check:

docker compose ps

Persistent Docker volumes are used for PostgreSQL, Redis and Elasticsearch.

docker compose down preserves data.
docker compose down -v removes persistent data.

2. Backend Environment
cd backend
cp .env.example .env

Important variables:

PORT=3000
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000

DATABASE_URL=postgresql://reachinbox:reachinbox@localhost:5432/reachinbox?schema=public

REDIS_HOST=localhost
REDIS_PORT=6379

ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_EMAIL_INDEX=emails

WORKER_CONCURRENCY=5
MIN_EMAIL_DELAY_MS=2000
EMAILS_PER_HOUR=50

SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

SESSION_SECRET=
SESSION_TTL_HOURS=168

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=http://localhost:3000/auth/slack/callback
SLACK_SCOPES=chat:write,channels:read,team:read
SLACK_ALERT_CHANNEL=

ADMIN_EMAILS=
DEV_AUTH_BYPASS=false

Never commit .env.

3. Install and Initialize Backend
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
Ethereal

Generate SMTP credentials:

npm run ethereal:setup

Add the generated credentials to .env.

4. Google OAuth

Configure a Google OAuth Web Application with:

JavaScript origin:
http://localhost:5173

Redirect URI:
http://localhost:3000/auth/google/callback

Set the corresponding Google credentials in .env.

5. Slack OAuth

Configure Slack OAuth with:

Redirect:
http://localhost:3000/auth/slack/callback

Scopes:

chat:write
channels:read
team:read

Set the Slack credentials in .env.

Slack connections are stored server-side and can be disconnected/reconnected without redeployment.

Running the Application
Terminal 1 — API
cd backend
npm run dev

API:

http://localhost:3000
Terminal 2 — Worker
cd backend
npm run worker:dev
Terminal 3 — Frontend
cd frontend
npm ci
npm run dev

Frontend:

http://localhost:5173
Email Processing
Compose
   │
   ▼
POST /api/emails/schedule
   │
   ▼
PostgreSQL
   │
   ▼
BullMQ delayed job
   │
   ▼
Worker
   │
   ├── Idempotency check
   ├── Minimum-delay check
   ├── Hourly rate-limit check
   │
   ├── Allowed ──────► Ethereal SMTP
   │                         │
   │                         ▼
   │                  Mark SENT + Elasticsearch
   │
   └── Rate limited ─► Slack alert
                          │
                          ▼
                     Reschedule job
Persistence

The system is designed so scheduled jobs survive application/container restarts.

PostgreSQL uses a persistent Docker volume.
Redis uses a persistent Docker volume with AOF enabled.
BullMQ delayed jobs are stored in Redis.
Elasticsearch uses a persistent Docker volume.
Restart verification

A future email was scheduled, the API/worker were stopped, and then restarted after the scheduled time. The queued email was successfully processed after restart.

Idempotency

Each email has a stable database ID.

BullMQ jobs use deterministic IDs:

email:<emailId>

The worker checks the email status before sending.

Terminal states such as SENT, CANCELLED and FAILED prevent unnecessary duplicate processing.

The implementation provides practical at-least-once processing with database-backed idempotency.

There is an unavoidable crash window between external SMTP acceptance and the database status update; exact-once SMTP delivery cannot be guaranteed using only SMTP and PostgreSQL.

Concurrency & Rate Limiting
Worker concurrency

Configured through:

WORKER_CONCURRENCY=5
Minimum delay

Configured through:

MIN_EMAIL_DELAY_MS=2000

Redis coordinates the send-delay gate across workers.

Hourly rate limit

Configured through:

EMAILS_PER_HOUR=50

Limits are scoped per sender.

Redis atomic operations reserve hourly send slots using sender/hour keys.

When the limit is reached:

Limit reached
     ↓
Slack notification
     ↓
Job delayed
     ↓
Next hourly window
     ↓
Job processed

Jobs are rescheduled rather than dropped.

The implementation uses UTC hourly buckets rather than a rolling 60-minute window.

Slack Notifications

When an hourly sender limit is reached, Slack receives a notification containing relevant sender/limit information.

Redis prevents duplicate notifications for the same sender/hour.

Slack failure is non-fatal to email processing.

The Slack integration was tested with:

OAuth connection
Channel notification
Disconnect
Reconnect
Rate-limit notification
Elasticsearch

Emails are indexed into:

emails

Search can cover:

recipient
subject
body

PostgreSQL remains the source of truth.

Bull Board

Queue monitoring:

http://localhost:3000/admin/queues

Bull Board provides visibility into:

waiting
delayed
active
completed
failed jobs
API Overview
Authentication
GET  /auth/google
GET  /auth/google/callback
GET  /api/auth/me
POST /api/auth/logout
Emails
POST /api/emails/schedule
GET  /api/emails/scheduled
GET  /api/emails/sent
GET  /api/emails/search
GET  /api/emails/stats
GET  /api/emails/:id
POST /api/emails/:id/cancel
POST /api/emails/parse-recipients
Senders
POST   /api/senders
GET    /api/senders
DELETE /api/senders/:id
Testing

Backend tests cover:

recipient parsing
idempotency
rate limiting

Current result:

27 / 27 tests passing

Run:

cd backend
npm test
npm run typecheck

Frontend:

cd frontend
npm run typecheck
npm run build
Assignment Requirement Mapping
Requirement	Implementation
TypeScript + Express	Implemented
PostgreSQL/MySQL	PostgreSQL + Prisma
BullMQ	Implemented
Delayed jobs	BullMQ
No cron	Implemented
Ethereal SMTP	Implemented
Multiple senders	Sender records supported
Persistence	PostgreSQL + Redis AOF + Docker volumes
Idempotency	Deterministic jobs + DB status
Concurrency	Configurable BullMQ workers
Minimum delay	Redis coordination
Hourly limit	Atomic Redis reservation
Rate-limit rescheduling	BullMQ delayed retry
Slack OAuth	Implemented
Slack notification	Implemented
Slack reconnect	Implemented
Elasticsearch	Implemented
Bull Board	Implemented
1000+ emails	Bulk queue insertion
Google OAuth	Implemented
Dashboard	React + TypeScript
CSV/TXT upload	Implemented
Scheduled/Sent views	Implemented
5-Minute Demo
Start Docker services.
Start API.
Start worker.
Start frontend.
Login with Google.
Compose and schedule multiple emails.
Show Scheduled Emails.
Open Bull Board and show delayed jobs.
Show Sent Emails.
Open Ethereal preview.
Demonstrate restart persistence.
Optionally demonstrate hourly rate limiting with limit 1 and show the Slack notification.
Security Notes
.env is ignored and must never be committed.
OAuth credentials should be kept private.
Generate a strong SESSION_SECRET.
DEV_AUTH_BYPASS=false for the assignment/demo.
Elasticsearch authentication is disabled only for local Docker development.
Production deployment should use HTTPS, secure secrets, authenticated Elasticsearch and restricted Bull Board access.
Final Status

Implemented and tested:

Email scheduling
BullMQ delayed jobs
PostgreSQL persistence
Redis persistence
Restart recovery
Idempotency
Worker concurrency
Minimum send delay
Hourly rate limiting
Rate-limit rescheduling
Slack OAuth and notifications
Slack reconnect
Google OAuth
Ethereal SMTP
Elasticsearch indexing/search
Bull Board
React dashboard
CSV/TXT recipient parsing
1000-recipient batch scheduling
Automated tests

Test result: 27/27 passing.