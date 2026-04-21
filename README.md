# CTGD Result Processing System

Production-ready monorepo for CTGD result ingestion, SOP-based processing, merit generation, and force allocation.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+

## Project structure

```
ctgd-system/
  backend/   Express API + Prisma + processing pipeline
  frontend/  Next.js (App Router) UI (DB-driven)
  db/        SQL + seed assets
  docs/      API docs + SOP notes
```

## Setup

### 1) Database

Create a database (example `ctgd`), then set `DATABASE_URL` in `backend/.env`.

### 2) Install dependencies

From `ctgd-system/`:

```bash
npm install
```

### 3) Prisma migrate + seed

```bash
npm run db:migrate -w backend
npm run db:seed -w backend
```

### 4) Run dev servers

```bash
npm run dev
```

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:3000`

## Important: exact UI HTML

The frontend is wired to be **API-driven**. To meet the “EXACT HTML (no design changes)” requirement, place your provided HTML/CSS into `frontend/ui-source/` and the pages will render it via component wrappers.

If you paste the HTML files into the workspace, I will convert them into reusable Next.js components without altering markup/classes/styles.

