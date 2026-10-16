# Shopping assistant app

A Next.js home goods shop with a [Vercel AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) assistant. The assistant searches products, checks the cart and suggests available substitutes. The shopper uses visible controls to add items and place a synthetic order. SQLite enforces stock, the stored budget (initially $150) and product revisions independently of model advice.

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

The browser keeps unresolved checkout identity in session storage, including after reload. Use “Check previous checkout” to resolve an uncertain response; a known previous order is displayed as already placed and does not purchase the newer bag.

## Native assistant and verification

Configure the environment from [.env.example](.env.example). The route owns a bounded native OpenAI Responses run with no SDK retries, four HTTP/SDK steps, 24 read invocations, a 2048-token output request, parent cancellation and deadlines. Original completion metadata is validated before the SDK can execute a read; successful replies require a completed nonblank terminal answer. Read-only tools cannot change the cart or checkout.

Each run writes a private `.runs/<run-id>/receipt.json` containing task/source hashes, initial/final state, original provider bodies/usage and failures, actual tool results, separately labeled normalized SDK usage and cleanup evidence. Unknown counts and cost stay unknown. Keep these local receipts private: they contain chat and source data. Detailed guarantees, limits and protocol references are in [COMPATIBILITY.md](COMPATIBILITY.md).

`npm test` passes 46 domain/native checks. After building, run `npx playwright install chromium && npm run test:e2e` for five production Chromium flows. The isolated local scripted provider drives the actual AI SDK and read tools without a paid model: four-response shopping advice, visible error/recovery, long-answer follow-up, and separate checkout lost-acknowledgement/reload and changed-price review. These checks establish SDK/application behavior, not live advice quality or billing. Typecheck and production build also pass; Linux CI repeats these gates.

Full cart command identity/concurrency, rich cases, imported history and fresh distribution checks remain in [PLAN.md](PLAN.md). Live advice requires provider access and human review. Firedrill integration awaits its qualified new release. The repository is private with no selected public license.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.
