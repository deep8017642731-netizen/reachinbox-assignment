# ReachInbox Email Scheduler

Full-stack **email job scheduler** built for the ReachInbox.ai / Outbox Labs software
development internship assignment.

> ⚠️ **Status: under active construction.**
> This README is completed in the documentation phase (see `docs/architecture.md`).
> The full README — setup, architecture, API reference, demo script and the
> requirement-audit table — is written once every phase of the build is verified.

## What this project will do

- Accept email scheduling requests over a REST API
- Persist business state in PostgreSQL (Prisma)
- Schedule persistent delayed jobs in **BullMQ + Redis** (no cron, no polling)
- Deliver mail through **Ethereal SMTP** (Nodemailer) with idempotency protection
- Enforce a configurable **minimum delay** and **hourly rate limit** across workers
- **Reschedule** — never drop — jobs that hit the rate limit
- Send a **real Slack notification** (real Slack OAuth 2.0) when a limit is hit
- Index emails in **Elasticsearch** for search
- Expose a real **Bull Board** queue dashboard
- Provide a **React + TypeScript + Tailwind** dashboard with Google OAuth login

## Quick start (will be finalised in the docs phase)

```bash
docker compose up -d          # PostgreSQL + Redis + Elasticsearch
cd backend && npm install     # install backend dependencies
cp .env.example .env          # then fill in your credentials
npx prisma migrate dev        # create database tables
npm run dev                   # API server
npm run worker:dev            # BullMQ worker (separate terminal)
```
