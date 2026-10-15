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

Open `http://localhost:3000`. The first server start creates `data/shop.db` with six synthetic products and the demo cart. Delete that ignored database to reset. Set `OPENAI_API_KEY` and `OPENAI_MODEL` to an enabled model for live assistant chat; the UI and cart work without a key, and the chat route returns a clear unavailable response when one is absent.

The assistant's tools read the current catalog, cart and same-category alternatives. It cannot mutate the cart or checkout. `POST /api/cart` rechecks product revision, stock and budget; `POST /api/checkout` rechecks stock and budget in one SQLite transaction, records a local order and clears the cart. A changed stock count prevents checkout without losing cart contents. This is synthetic ordering: no payment, shipping or external commerce service is connected.

The tests cover unavailable products, substitution, budget overshoot, stale revision, changed stock, checkout and persistence. Typecheck and production build cover the UI and model route. A local browser check added a mug, showed $122 remaining, placed a $28 synthetic order, and found no mobile overflow. The chat route returned a clear 503 without provider configuration. Live model response quality and token usage remain unmeasured until provider access is available. Firedrill integration awaits its qualified new release. The repository is private with no selected public license.
