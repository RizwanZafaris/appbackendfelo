# Claude Code notes — appbackendfelo

This is the **NestJS backend** for Felo. One of three repos. The
canonical project-wide handoff is at:

    /Users/rizwanzafar/Desktop/Felo_Project/FELO_HANDOFF.md

…if available. If the parent project directory isn't on disk, this
file plus the others below have what you need.

## Active branch

`soft-launch/v1` — manual remittance notebook only, money modules
disabled. See `LAUNCH_FLAGS.md` for what's parked under
`_disabled_money_modules/` and how to re-enable.

## Source of truth

| Topic | Read |
|---|---|
| Module wiring + active features | `src/app.module.ts` |
| Disabled money modules | `_disabled_money_modules/` (excluded from `tsconfig.json`) |
| Schema | `db/schema/index.ts` (Drizzle TS — canonical) and `db/supabase/0*.sql` (executable) |
| Env validation | `src/config/config.ts` (`configFactory`) |
| Pre-flight env check | `scripts/check-prod-config.ts` |
| Migration runner | `scripts/apply-migrations.sh` |
| Operational checklist | `OPS_CONFIG.md` |
| Launch readiness | `LAUNCH_READINESS.md` |
| Re-enable money | `LAUNCH_FLAGS.md` |

## Conventions (do NOT violate)

- The Supabase project is `qooaehrmlhenfrklzcht`. The OLD project
  ref `xetosbkkjowlspfxffoj` was leaked and must NEVER appear in any
  commit. CI's `forbidden-strings` job enforces this.
- Never reintroduce `JwtAuthGuard` (the no-op shim was deleted; CI
  blocks).
- Never use `:6543` in `DATABASE_URL` — `configFactory` rejects it.
- `FELO_LAUNCH_READY=1` is the master gate; never default to `1`,
  set explicitly in production env once `OPS_CONFIG.md` is signed off.
- The `.env.production.local` file is gitignored. Never commit it.
  Never echo its contents.

## Quick-validate

```bash
npm run build                          # must be silent
set -a && . ./.env.production.local && set +a
npx --no-install tsx scripts/check-prod-config.ts
```

## Live infrastructure

- Backend: `https://appbackendfelo-production.up.railway.app/v1`
- Supabase: `https://qooaehrmlhenfrklzcht.supabase.co` (ap-northeast-1, port 5432)

## Known follow-ups

See `LAUNCH_READINESS.md` "P1 — Within 30 days" + `LAUNCH_FLAGS.md`
"Hard re-enable checklist".
