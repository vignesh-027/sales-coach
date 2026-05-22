# Sales Coach

AI-powered journey-closing call analysis platform for Antano & Harini's Excellence Installations programs (CTD, BiG, FTM, uP, CPM, EI Solution, SMP, and continuity variants).

Closers upload a call recording. The platform transcribes it, retrieves the most relevant founder material and reference-call moments from a vector knowledge base, sends everything to Claude with a founder-voice prompt, and returns a structured report — top-5 craft rubric, state-shift key moments, higher-leverage move suggestions with playbook citations, and cross-call patterns.

The output is read like a founder reading the call back to the closer — not a generic sales-coaching dashboard.

---

## Table of contents

1. [Architecture](#architecture)
2. [Tech stack](#tech-stack)
3. [Repository layout](#repository-layout)
4. [Prerequisites](#prerequisites)
5. [Local setup](#local-setup)
6. [Environment variables](#environment-variables)
7. [Running locally](#running-locally)
8. [Database migrations](#database-migrations)
9. [Operational scripts](#operational-scripts)
10. [Deployment](#deployment)
11. [CI / CD](#ci--cd)
12. [Observability](#observability)
13. [Security](#security)
14. [Troubleshooting](#troubleshooting)

---

## Architecture

```
                       ┌─────────────────────────┐
   Browser ─────────►  │  Next.js 16 (Vercel)    │  ◄──── AssemblyAI webhooks
                       │  • App Router + RSC     │        (transcription complete)
                       │  • Supabase Auth (SSR)  │
                       │  • Admin observability  │
                       └────────────┬────────────┘
                                    │ enqueue
                                    ▼
                       ┌─────────────────────────┐
                       │  Trigger.dev v4 workers │
                       │  (long-running tasks)   │
                       │                         │
                       │  ingest-call-recording  │
                       │  poll-transcription     │
                       │  embed-call             │
                       │  analyze-call (Claude)  │
                       │  ingest-knowledge       │
                       │  ingest-text            │
                       │  embed-transcript       │
                       └────────────┬────────────┘
                                    │
        ┌───────────────┬───────────┼─────────────┬──────────────┐
        ▼               ▼           ▼             ▼              ▼
   ┌─────────┐   ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐
   │Supabase │   │Cloudflare│  │AssemblyAI│  │ Voyage AI│  │Anthropic │
   │Postgres │   │   R2     │  │transcribe│  │ embed +  │  │ Claude   │
   │+ pgvector│  │ (audio)  │  │          │  │ rerank   │  │ analyze  │
   └─────────┘   └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

**Request flow for a call:**

1. Closer uploads a recording → web tier returns a presigned R2 PUT URL → browser uploads direct to R2.
2. Web tier enqueues `ingest-call-recording` on Trigger.dev.
3. Worker sends audio to AssemblyAI with a webhook callback.
4. AssemblyAI POSTs back to `/api/calls/transcription-callback` when ready.
5. Web tier enqueues `embed-call` → chunks transcript, embeds with Voyage, writes to `call_chunks`.
6. `analyze-call` runs: hybrid search (vector + keyword) over `knowledge_chunks` + `call_chunks`, reranks with Voyage `rerank-2.5-lite`, sends top chunks + transcript + system prompt to Claude with a forced `save_call_report` tool call.
7. Zod validator on the worker side rejects malformed tool input and retries.
8. Validated report is upserted to `call_reports` (second Zod gate). UI renders it.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Web framework | Next.js 16 (App Router, RSC, middleware) | Server components for auth-gated pages, edge-friendly proxy |
| Workers | Trigger.dev v4 | 20-min run budget, retries, dashboard observability |
| Database | Supabase Postgres + `pgvector` | Auth, RLS, managed backups, vector search |
| Object storage | Cloudflare R2 | Egress-free, S3-compatible |
| Transcription | AssemblyAI | Multilingual, webhook-driven |
| Embeddings + rerank | Voyage AI (`voyage-4-large` 1024-d, `rerank-2.5-lite`) | Top-tier retrieval quality, predictable pricing |
| LLM analysis | Anthropic Claude (Haiku 4.5 / Sonnet 4.5 / Opus 4.1) | Tool-use for structured output, model selectable per environment |
| Structural validation | Zod | Single source of truth for LLM output shape; enforced at both worker and DB write boundaries |
| Error monitoring | Sentry (production only) | Sourcemap-aware Next.js integration |
| Hosting | Vercel (web) + Trigger.dev Cloud (workers) | Native Next.js, native worker dashboard |

---

## Repository layout

```
sales-coach/
├── app/                          # Next.js App Router
│   ├── (main)/                   # Authenticated app shell
│   ├── (modal)/calls/[id]/       # Call detail (transcript + report)
│   ├── _components/              # Shared UI primitives
│   ├── _landing/                 # Public landing page
│   ├── api/                      # Route handlers (REST + webhooks)
│   ├── auth/                     # Supabase auth callback
│   └── signin/                   # Sign-in page
├── worker/                       # Trigger.dev v4 tasks
│   ├── ingest-call-recording.ts
│   ├── poll-transcription.ts
│   ├── embed-call.ts
│   ├── embed-transcript.ts
│   ├── analyze-call.ts
│   ├── ingest-knowledge.ts
│   └── ingest-text.ts
├── services/                     # Backend integrations (importable by app + workers)
│   ├── anthropic/                # Claude client, prompt, tool schema, Zod validator
│   ├── assemblyai/               # Transcription client + webhook helpers
│   ├── voyage/                   # Embedding + reranking client
│   ├── r2/                       # Presigned URLs, CORS, multipart
│   ├── supabase/                 # Server/admin clients, queries, migrations
│   └── upload/                   # Browser-side upload orchestration
├── scripts/                      # Operational + diagnostic scripts (local only)
├── lib/                          # Cross-cutting helpers
├── proxy.ts                      # Next.js middleware (auth + webhook passthrough)
├── trigger.config.ts             # Trigger.dev project config
├── instrumentation.ts            # Sentry server init
├── instrumentation-client.ts     # Sentry browser init
├── next.config.ts                # Next.js config (wrapped with Sentry)
└── .github/workflows/            # CI/CD (Trigger.dev deploy)
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node | 20.x | Pinned in `engines` |
| npm | 10+ | ships with Node 20 |
| Supabase project | — | Postgres + Auth + pgvector extension enabled |
| Cloudflare R2 bucket | — | with API token (Read+Write) |
| Anthropic API key | — | claude.ai/console |
| Voyage AI API key | — | voyageai.com |
| AssemblyAI API key | — | assemblyai.com |
| Trigger.dev account | — | one project linked to this repo |
| Vercel account | — | one project linked to this repo |
| Sentry project | — | optional for local; required for production |

---

## Local setup

```bash
git clone <repo-url>
cd sales-coach
npm install
cp .env.example .env.local        # if .env.example exists; otherwise see env section
# fill in .env.local with your dev credentials
npm run db:migrate                # apply all SQL migrations
npm run dev                       # http://localhost:3000
```

In a second terminal, run the workers locally against Trigger.dev dev env:

```bash
npx trigger.dev@latest dev
```

Both must be running for the full pipeline (upload → transcribe → embed → analyze) to work end-to-end.

---

## Environment variables

All secrets live in `.env.local` (gitignored). Never commit them. The same set must also be configured in the Vercel project (web tier) and Trigger.dev `prod` env (workers) for production.

### Supabase
```
Supabase_Project_URL=
Supabase_Anon_Key=
Supabase_Service_Role_Key=
Supabase_Database_Connection_String=     # direct connection, port 5432
```

### Cloudflare R2
```
R2_AccountID=
R2_Access_Key_ID=
R2_Secret_Access_Key=
R2_BucketName=
R2_S3API=                                # https://<account>.r2.cloudflarestorage.com
R2_CORS_ORIGINS=                         # comma-separated; include the Vercel URL
```

### AI providers
```
ANTHROPIC_API_KEY=                       # alias: Claude_API_Key / CLAUDE_API_Key
Voyage_API_Key=                          # alias: VOYAGE_API_KEY / VOYAGEAI_API_KEY
VOYAGE_THROTTLE_MS=21000                 # optional, free-tier 3 RPM
VOYAGE_SUBBATCH=20                       # optional
AssemblyAI_API_Key=
```

### Trigger.dev
```
TRIGGER_PROJECT_ID=proj_xxxxxxxxxxxx     # alias: Trigger_Project_ID
TRIGGER_SECRET_KEY=tr_prod_xxxxxxxx      # alias: Trigger_Secret_key — use tr_dev_* for local
```

### Sentry (production only)
```
NEXT_PUBLIC_SENTRY_DSN=                  # public-safe, ships to browser by design
SENTRY_AUTH_TOKEN=sntrys_xxxxxxxx        # build-time only, for sourcemap upload
SENTRY_ORG=
SENTRY_PROJECT=
```

### App
```
PUBLIC_BASE_URL=http://localhost:3000    # set to https://<vercel-url> in prod
```

---

## Running locally

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server on `http://localhost:3000` |
| `npx trigger.dev@latest dev` | Local worker that connects to Trigger.dev dev env |
| `npm run build` | Production build (used by Vercel) |
| `npm start` | Run the production build locally |
| `npm run db:migrate` | Apply all SQL migrations in `services/supabase/migrations/` |
| `npm run trigger:deploy` | Deploy workers to Trigger.dev (usually run by CI) |

---

## Database migrations

Migrations are plain SQL files in `services/supabase/migrations/`, numbered `0001_*.sql` through `0013_*.sql`. The runner applies them in order and tracks applied versions.

```bash
# Apply all pending migrations
npm run db:migrate

# Apply one specific migration (rarely needed)
npx tsx scripts/apply-single-migration.ts 0007_voyage_1024.sql
```

**Note on 0007:** This migration truncates the `embedding` columns on `knowledge_chunks` and `call_chunks` to switch from 768-d Gemini to 1024-d Voyage. Any existing embeddings are wiped — re-embed with `scripts/voyage-reembed-all.ts` afterward if needed.

---

## Operational scripts

All scripts under `scripts/` are **local-only** — they're never bundled into Vercel functions or Trigger.dev workers. They exist for one-off diagnosis, backfill, and pipeline rehearsal.

| Script | Purpose |
|---|---|
| `run-migrations.ts` | Apply all SQL migrations |
| `voyage-reembed-all.ts` | One-time re-embed after model change |
| `r2-set-cors.ts` | Push CORS config to R2 bucket |
| `diag-rerun-and-save.ts` | Re-run only the LLM analysis step for a call (no re-transcription) |
| `diag-raw-claude.ts` | Dump raw Claude tool_use output for debugging schema mismatches |
| `bulk-upload.ts` | Batch-upload call recordings (testing) |
| `eval-retrieval.ts` | Evaluate hybrid-search recall against `eval-queries.json` |

Run any script with:
```bash
npx tsx --env-file=.env.local scripts/<name>.ts [args]
```

---

## Deployment

### Production environments

| Tier | Host | Project |
|---|---|---|
| Web | Vercel | `salescoach` → `https://ahsalescoach.vercel.app` |
| Workers | Trigger.dev Cloud | `proj_*` (see `trigger.config.ts`), env `prod` |
| Database | Supabase | Free tier (daily auto-backups) |
| Storage | Cloudflare R2 | bucket `sales-calls` |

### Manual deploy (fallback)

```bash
# Web
npx vercel --prod

# Workers
npx trigger.dev@latest deploy --env prod
```

Both must be deployed for changes to take effect end-to-end. The CI pipeline below handles this automatically.

### First-time production setup

See the deploy runbook for the full step-by-step (R2 CORS, Sentry wizard, Supabase URL allowlist, etc.). Once it's set up, day-to-day deploys go through git push.

---

## CI / CD

We use a **two-channel auto-deploy** model — each tier deploys independently from the same `main` branch.

### Channel 1: Web tier (Vercel native GitHub integration)

- **Trigger:** every push to `main`.
- **Mechanism:** Vercel's GitHub App watches the repo and runs `next build` + deploys to production automatically.
- **Setup:** Vercel dashboard → project → Settings → Git → Connect Git Repository. No workflow file needed.
- **Preview deploys:** every PR gets its own preview URL automatically.

### Channel 2: Workers (GitHub Actions)

- **Trigger:** push to `main` that touches `worker/`, `services/`, `trigger.config.ts`, or `package*.json`.
- **Mechanism:** [`.github/workflows/deploy-trigger.yml`](.github/workflows/deploy-trigger.yml) runs `npx trigger.dev@latest deploy --env prod`.
- **Required repo secret:** `TRIGGER_ACCESS_TOKEN` — a Personal Access Token from [cloud.trigger.dev/account/tokens](https://cloud.trigger.dev/account/tokens). Not the project secret key.
- **Path-filtering** ensures the workflow doesn't run on web-only changes, keeping deploys fast and cheap.
- **Manual trigger:** the workflow also supports `workflow_dispatch` from the Actions tab.

### Why two channels, not one monorepo deploy?

- Vercel and Trigger.dev have first-class native integrations — using them is faster, free, and gives better dashboards than a hand-rolled Action.
- Path filtering means a tweak to a React component doesn't waste 90 seconds redeploying workers, and a worker change doesn't waste a Vercel build minute.
- Failure isolation: if the Trigger.dev deploy fails, the web tier still ships, and vice versa. Both have one-click rollbacks in their own dashboards.

### Rollback

| Tier | How |
|---|---|
| Web | Vercel dashboard → Deployments → previous deploy → **Promote to Production** (instant) |
| Workers | `npx trigger.dev@latest deploy` against the previous git SHA |
| Database | Supabase dashboard → Backups → restore most recent daily snapshot |

---

## Observability

- **`/admin/observability`** — token usage, cost rollup (Voyage embed + rerank, Claude per-model), recent failures. Open to all signed-in users by design.
- **`/admin/settings`** — model picker (LLM and reranker), admin-gated.
- **Trigger.dev dashboard** — per-task run history, logs, retries.
- **Sentry** — production-only error tracking with source-mapped stack traces.
- **Vercel** — function logs, build logs, deploy history.

---

## Security

- All secrets live in `.env.local` (gitignored) and in the Vercel + Trigger.dev secret stores. None are hardcoded.
- `NEXT_PUBLIC_SENTRY_DSN` ships to the browser by design — Sentry DSNs are public-safe (write-only, rate-limited).
- Supabase Row-Level Security policies guard every user-facing table.
- Webhook endpoints (`/api/calls/transcription-callback`, `/api/knowledge/transcription-callback`) are intentionally public — AssemblyAI authenticates via the URL token in the callback config.
- The Zod validator at `services/anthropic/call-report-schema.ts` is the **single enforcement point** for LLM output structure. Both the worker boundary and the DB write boundary parse through it — a malformed report can never reach the database or the UI.
- Pre-commit: confirm `git status` shows no `.env*`, `.vercel/`, `.trigger/`, or `.claude/` files before pushing.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `.env.local: not found` running a script | Wrong CWD | `cd` to project root, then re-run |
| Worker deploy hangs on Depot upload | Trigger.dev build infra slowness | Retry `npx trigger.dev@latest deploy` — usually clears in one retry |
| Call analysis returns `key_moments` as a string | Sonnet emitted JSON-encoded array | Already handled by `analyze-call.ts` merge logic + Zod retry |
| Migration fails on `pooler.supabase.com:6543` | Using transaction-mode pooler | Switch `Supabase_Database_Connection_String` to direct connection (port 5432) |
| R2 PUT returns CORS error | Vercel URL not in `R2_CORS_ORIGINS` | Add it, re-run `npx tsx --env-file=.env.local scripts/r2-set-cors.ts` |
| Vercel deploy 500s on first request | `PUBLIC_BASE_URL` not set | Set it to the assigned Vercel URL, redeploy once |

---

## License

Proprietary — internal use only.
