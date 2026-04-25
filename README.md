# Felo Backend

> **Phase 1 backend for [Felo](https://github.com/RizwanZafaris/appuifelo).**
> NestJS 10 + TypeScript strict + Drizzle ORM + Postgres (Supabase-compatible).
> Companion spec: `02_Engineering/FELO_Backend_Build_Spec.md` in the Obsidian vault.

## Stack

| Layer | Choice |
|---|---|
| Framework | NestJS 10 |
| Language | TypeScript 5 (strict) |
| ORM | Drizzle |
| Database | Postgres 16 (Supabase compatible — RLS-ready) |
| Auth | Firebase Admin → Felo JWT (15min access + 30d refresh) |
| Validation | class-validator + class-transformer |
| Docs | OpenAPI 3.1 / Swagger UI at `/docs` |
| Logging | nestjs-pino (structured, redacted) |

## Quick start (local Postgres)

```bash
# 1. Bring up the DB only
docker compose up -d postgres

# 2. Install deps
npm ci

# 3. Copy env, fill JWT_SECRET (32+ bytes random)
cp .env.example .env

# 4. Run dev server
npm run start:dev

# 5. Open Swagger
open http://localhost:3000/docs
```

The Postgres container auto-applies the schema from `db/supabase/000_init.sql` on first boot.

## Quick start (Supabase)

```bash
# 1. Create a Supabase project at https://supabase.com
# 2. SQL Editor → New query → paste contents of db/supabase/000_init.sql → Run
# 3. Project Settings → Database → Connection string → URI (Transaction pooler)
#    paste into DATABASE_URL in .env
# 4. Project Settings → API → service_role key (bypasses RLS) — use ONLY backend-side
# 5. npm run start:dev
```

## Folder layout

```
felo-backend/
├── db/
│   ├── schema/           Drizzle TypeScript schema (source of truth for queries)
│   ├── migrations/       Drizzle-generated SQL migrations
│   └── supabase/
│       └── 000_init.sql  Supabase-ready DDL with RLS policies (paste into SQL Editor)
├── src/
│   ├── common/           filters, guards, middleware, db, decorators
│   ├── config/           env validation
│   ├── modules/
│   │   ├── auth/         Firebase exchange + JWT mint
│   │   ├── health/       liveness + DB probe
│   │   ├── users/        /users/me CRUD
│   │   ├── accounts/     manual + linked accounts
│   │   ├── budgets/      envelope budgets with computed spend
│   │   ├── goals/        goals + contributions
│   │   └── transactions/ ledger with cursor pagination + delta sync
│   ├── app.module.ts
│   └── main.ts
├── test/
├── Dockerfile
├── docker-compose.yml
├── drizzle.config.ts
└── .github/workflows/ci.yml
```

## API (v1)

All routes prefixed `/v1`. All authenticated routes expect `Authorization: Bearer <jwt>`.

| Method | Path | Public? | Notes |
|---|---|---|---|
| `GET` | `/health` | yes | Liveness + DB probe |
| `POST` | `/auth/exchange` | yes | Firebase ID token → Felo JWT pair (just-in-time user provisioning) |
| `GET` | `/auth/me` | no | Echo back the bearer's identity |
| `GET` | `/users/me` | no | Full user record |
| `PATCH` | `/users/me` | no | Update name / language / corridor |
| `DELETE` | `/users/me` | no | Soft-delete (30-day grace) |
| `GET` `POST` `PATCH` `DELETE` | `/accounts[/:id]` | no | Account CRUD |
| `GET` `POST` `PATCH` `DELETE` | `/budgets[/:id]` | no | Budget CRUD; `GET /:id` includes computed `spentMinor` |
| `GET` `POST` `PATCH` `DELETE` | `/goals[/:id]` | no | Goal CRUD |
| `POST` | `/goals/:id/contributions` | no | Increment `savedMinor` |
| `GET` | `/transactions` | no | Cursor-paginated by `booked_at desc` |
| `GET` | `/transactions/sync` | no | Delta sync — rows updated after `?since=` |
| `GET` `POST` `PATCH` `DELETE` | `/transactions[/:id]` | no | Transaction CRUD |

Full OpenAPI spec at `/openapi.json` once running.

## Security

- **JWT** is HS256 signed with `JWT_SECRET` (≥32 bytes recommended). Access token 15 min; refresh token 30 days.
- **Row-Level Security** on every table — see `db/supabase/000_init.sql`. Enforced both via Supabase Auth (`auth.uid()`) and the NestJS-set session var (`app.user_id`).
- **PII redaction** in logs (`Authorization`, `firebaseIdToken`, `password`).
- **No secrets in the repo** — `firebase-service-account*.json` is gitignored. Store credentials in your CI secret store (GitHub Actions secrets / Doppler / AWS Secrets Manager).
- Set `CORS_ORIGINS` to a comma-separated allowlist of frontend origins.

## Deploy targets

Tested as portable to:
- **Fly.io** (recommended for Phase 1 — `fly launch && fly deploy`)
- **Railway** (auto-deploy from GitHub)
- **AWS ECS / Fargate** (use the included Dockerfile)
- **Google Cloud Run** (Dockerfile is multi-arch via buildx)

## Scripts

```bash
npm run start:dev      # watch mode
npm run lint           # eslint --fix
npm test               # jest unit tests
npm run build          # compile to dist/
npm run db:generate    # generate Drizzle migration from schema diff
npm run db:migrate     # apply pending migrations
npm run db:studio      # Drizzle Studio (interactive DB UI)
```

## Roadmap

- [x] Phase 1: domestic-only, no money movement
- [ ] Notifications service (FCM + email outbox)
- [ ] Family service (invites, consent ledger viewer)
- [ ] AI Coach gateway (Python sidecar)
- [ ] SMS Parser service (Python sidecar)
- [ ] Phase 3: Remittance orchestrator (gated on signed MSB partner LOI)

## License

UNLICENSED — internal Felo project.
