# PocketWorld

An original digital arcade, customizable world, collectibles, gifting and internal Play Coin marketplace by **Noetfield Systems Inc.**

- Runtime: Bun + TypeScript + PostgreSQL, hosted on Railway.
- Guest world, one-time recovery code, skill-based memory game, custom world equipment, shop, transfer/gift, secondary Play Coin market, digital greeting cards and time capsules.
- Play Coins and XP are **game-only**, not money, cryptocurrency, investments, or cash-redeemable rewards.
- This is an independent issuer of its own digital experiences. No restaurant or third-party gift-card partnerships.

## Local development

```bash
bun install
DATABASE_URL=postgresql://localhost/pocketworld bun run start
```

The server creates namespaced `pw_` tables idempotently on first database access. Set `PORT` (Railway provides it) and `DATABASE_URL`. Do not commit connection strings or webhook keys.

## Verification

```bash
POCKETWORLD_URL=https://pocketworld-web-production.up.railway.app node tests/smoke.mjs
```

The smoke suite exercises real PostgreSQL-backed flows and creates synthetic `E2E-` users. The production check must run only against the expected PocketWorld service.

## Customer-facing position

- Digital play, creative gifts and collecting are real features; free trial features do not imply paid purchases.
- The existing Play Coin market is not a cash marketplace.
- Any paid product must be fulfilled on verified payment status and must not be inferred from a redirect alone.

## Deployment

Railway project: `pocketworld-arcade`. The production app source of truth is this repository; avoid replacing the old function until the GitHub-sourced service passes readiness checks.
