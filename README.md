# Mochiloom — original tiny-world entertainment

**Mochiloom** (working product name) is the current consumer-facing identity of the web app maintained in the existing `Noetfield-Systems/PocketWorld` engineering repository. The business and original in-house software are operated by **Noetfield Systems Inc.**

Our original virtual companions, worlds, skill games, digital collectibles, giftable cards, time capsules and Play Coin community market are first-party. We do not resell other merchants' gift cards or depend on restaurant partnerships to operate.

## Live product

Production Railway service: `pocketworld-github-web` (temporary technical hostname; brand is Mochiloom in the UI).

## Core stack

- Bun, TypeScript, `postgres` and PostgreSQL.
- `src/index.ts`: API, secure guest session, original collectible economy, responsive application.
- `src/live.ts`: original studio helper characters, timed editorial duties, factual events, daily quest claim and safe template-based kindness wall.
- `tests/smoke.mjs`: live data and transaction E2E checks.
- `tests/browser.mjs`: actual Chromium desktop/mobile journeys and screenshots.

## Development

```bash
bun install
DATABASE_URL=postgresql://localhost/mochiloom bun run dev
```

Automatic backend schema setup is namespaced `pw_` because the app evolved from the original technical codename; existing database records continue unchanged.

## Brand and customer truth

- Public name **Mochiloom** is a provisional candidate pending comprehensive trademark and domain clearance; do not mark it ® or assert registration.
- The name *Pocket World* is registered by an independent third party in Canada for game software (CIPO `TMA1208097`); avoid using it as a product-facing wordmark.
- **Official helpers are fictional first-party staff characters** and are explicitly labeled as automated. They are not fake customers, and their task events describe real studio operations.
- Community totals, purchases and activities come from actual records; test users and test listings are excluded publicly.
- Play Coins, XP and game collectibles have no monetary value, interest, investment return or cash withdrawal. The Play Coin marketplace is not a real-money marketplace.
- No third-party gift card, physical shipping, or real Stripe payment checkout is active unless independently deployed and verified.

Copyright in original assets, artwork and implementation is subject to applicable law and contribution agreements. See `docs/BRAND_AND_IP.md` for preliminary clearance steps. The product is not affiliated with the third-party Canadian mark owner.
