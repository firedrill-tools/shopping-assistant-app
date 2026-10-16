# Shopping assistant app

A Next.js home goods shop with a [Vercel AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) assistant. The assistant searches products, checks the cart and suggests available substitutes. The shopper uses visible controls to add items and place a synthetic order. SQLite enforces stock, a $150 budget and product revisions independently of model advice.

## Run

Requires Node.js 24+ and npm:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

Open `http://localhost:3000`. The first server start creates `data/shop.db` with six synthetic products and the demo cart. Stop the server and use a new SHOP_DB path for an independent reset. New state has a distinct instance identity; existing private order history is preserved. Set `OPENAI_API_KEY` and `OPENAI_MODEL` to an enabled model for live assistant chat; the UI and cart work without a key, and the chat route returns a clear unavailable response when one is absent.

The assistant's tools read the current catalog, cart and same-category alternatives. It cannot mutate the cart or checkout. `POST /api/cart` rechecks product revision, stock and budget; `POST /api/checkout` requires JSON request_id and expected_cart_token from the reviewed shop state. It rechecks exact instance/cart revision/prices/stock/budget in one transaction, records an immutable local order and clears only that reviewed cart. A changed stock count prevents checkout without losing cart contents. This is synthetic ordering: no payment, shipping or external commerce service is connected.

Fourteen domain/HTTP checks cover unavailable products, substitution, budget, stale revisions, changed prices/stock, exact request recovery, strict/extra intent, precommit rollback, private new DB/WAL and populated legacy migration. Exact checkout replay returns its original order while preserving a later cart; the same ID with a different token fails. New files use 0600 and new private directories 0700; existing parent modes are preserved. Tokens bind state and are not authentication.

The browser keeps unresolved checkout identity in session storage, including after reload. Use “Check previous checkout” to resolve an uncertain response; a known previous order is displayed as already placed and does not purchase the newer bag. Strict checkout intent does not yet qualify full cart command retry/idempotency, native model completion/all-step usage or rich data/package proof; those tasks are tracked in [PLAN.md](PLAN.md).

Production browser checks (build first, then `npx playwright install chromium && npm run test:e2e`) use an isolated ignored database and no provider key. They exercise lost HTTP acknowledgement/reload/exact recovery with a newer cart, and changed-price review before a new order. They are synthetic shopper/UI proofs. Typecheck and production build cover the UI and model route. Typecheck and production build cover the UI and model route. An earlier local browser check added a mug, showed $122 remaining, placed a $28 synthetic order, and found no mobile overflow. The chat route returned a clear 503 without provider configuration. Live model response quality and token usage remain unmeasured until provider access is available. Firedrill integration awaits its qualified new release. The repository is private with no selected public license.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.
