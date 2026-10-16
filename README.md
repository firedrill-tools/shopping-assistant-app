# Shopping assistant app

A Next.js home goods shop with a [Vercel AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) assistant. The assistant searches products, checks the cart and suggests available substitutes. The shopper uses visible controls to add items and place a synthetic order. SQLite enforces stock, the stored budget (initially $150) and product revisions independently of model advice.

## Run

Requires Node.js 24+, npm and Python 3.9+ for dataset/distribution commands:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

Open `http://localhost:3000`. The first server start creates `data/shop.db` with six synthetic products and the demo cart. Stop the server and use a new SHOP_DB path for an independent reset. New state has a distinct instance identity; existing private order history is preserved. Set `OPENAI_API_KEY` and `OPENAI_MODEL` to an enabled model for live assistant chat; the UI and cart work without a key, and the chat route returns a clear unavailable response when one is absent.

The assistant's tools read the current catalog, cart and same-category alternatives. It cannot mutate the cart or checkout. `POST /api/cart` requires a stable request_id and exact expected_shop_token, then rechecks product revision, stock and budget; `POST /api/checkout` requires JSON request_id and expected_cart_token from the reviewed shop state. It rechecks exact instance/cart revision/prices/stock/budget in one transaction, records an immutable local order and clears only that reviewed cart. A changed stock count prevents checkout without losing cart contents. This is synthetic ordering: no payment, shipping or external commerce service is connected.

The original fourteen domain/checkout HTTP checks cover unavailable products, substitution, budget, stale revisions, changed prices/stock, exact request recovery, strict/extra intent, precommit rollback, private new DB/WAL and populated legacy migration. Exact checkout replay returns its original order while preserving a later cart; the same ID with a different token fails. New files use 0600 and new private directories 0700; existing parent modes are preserved. Tokens bind state and are not authentication.

The browser keeps unresolved checkout identity in session storage, including after reload. Use “Check previous checkout” to resolve an uncertain response; a known previous order is displayed as already placed and does not purchase the newer bag.

## Deterministic cases and private CLI

```sh
npm run shop -- cases
npm run shop -- init --case busy --db .local-state/busy.db
npm run shop -- show --db .local-state/busy.db
SHOP_DB=.local-state/busy.db npm run dev
```

Twelve versioned [cases](data/manifest.json) cover starter, busy, ambiguous and boundary profiles: unavailable substitutes, changed stock, exact/over budget, zero price/budget, safe minor units, revision exhaustion, quoted vendor instructions and prior orders. The busy case has 48 products, five bag lines and twenty prior synthetic human orders. The UI uses actual catalog counts/categories. Case tasks/focus are human review guidance and never enter model instructions or tool results implicitly.

Initialization checks original SHA256 bytes, strict shapes and coherent persisted facts, stages/validates a private database, then publishes exclusively to a new path. Existing databases, sidecars and links are refused. For a reset, stop the server and initialize a different new destination. New files/directories are 0600/0700; existing parents retain their modes. `show` uses SQLite read-only access, never creates/migrates missing or legacy sources, and needs no model/key. New case instances have distinct identities. Atomic-publication failures preserve any published target for inspection before retrying.

Imported history has explicit synthetic human provenance and null original request bindings. Its IDs/lines/prices/times/revisions are preserved; no provider trials or usage are fabricated. Optional strict dataset metadata binds original case/manifest hashes and imported order IDs for private source receipts. It does not claim the current mutable shop still matches its original seed. `npm run data:generate` deterministically regenerates LF source bytes from [fixtures/base.json](fixtures/base.json).

## Bag update recovery

Add/remove commands bind their original action, product, quantity, product revision and complete reviewed shop token to one stable request ID. The transaction records an immutable effect beside the cart update. Exact replay returns that original effect plus the current bag, without applying the action again; changed intent under the same ID fails. A shop/cart/catalog change requires fresh review. Tokens are local source bindings, not authentication.

The browser persists an unresolved bag command before dispatch, restores it after reload and exposes “Check previous bag update”. Resolve it before another shopper update or checkout. A delayed remove cannot erase a later entry of the same product. Original checkout recovery remains independent. New schema version 3 adds the private command ledger while retaining legacy orders with unknown original request provenance. Local `ShopStore.add/remove` helpers represent deliberately fresh operations; transport retries must use `ShopStore.command`.

## Source and history validation

Opening and reading the shop validates its owned schema, catalog, one demo cart, instance identity, original orders and bag-command acknowledgements under one transaction. Unknown tables/columns/triggers, broken references, unsafe minor units, invalid UTC times, incomplete request provenance, contradictory order totals/stock/revisions and malformed command history fail before action. Existing invalid records are not repaired into plausible history. Empty existing catalogs or missing owned tables/identity fail; a new empty database alone receives the starter catalog.

Orders retain original names/prices/lines/times/IDs and unknown legacy request provenance. Retired historical products remain valid. Consecutive product revisions must account for the prior order's stock decrement without a silent price/name change; revision gaps preserve current facts without inventing intervening restocks. An over-budget or unavailable-stock cart remains inspectable/removable and cannot checkout. This local bounded store supports 1–1000 products, at most 1000 orders and 5000 bag commands; exceeding a bound fails atomically.

## Native assistant and verification

Configure the environment from [.env.example](.env.example). The route owns a bounded native OpenAI Responses run with no SDK retries, four HTTP/SDK steps, 24 read invocations, a 2048-token output request, parent cancellation and deadlines. Original completion metadata is validated before the SDK can execute a read; successful replies require a completed nonblank terminal answer. Read-only tools cannot change the cart or checkout.

Each run writes a private `.runs/<run-id>/receipt.json` containing task/source hashes, initial/final state, original provider bodies/usage and failures, actual tool results, separately labeled normalized SDK usage and cleanup evidence. Unknown counts and cost stay unknown. Keep these local receipts private: they contain chat and source data. Detailed guarantees, limits and protocol references are in [COMPATIBILITY.md](COMPATIBILITY.md).

`npm test` passes 115 domain/native/source/dataset/CLI checks, including actual competing processes for one bag or checkout request. After building, run `npx playwright install chromium && npm run test:e2e` for nine production Chromium flows. The isolated local scripted provider drives the actual AI SDK and read tools without a paid model: four-response shopping advice, visible error/recovery, long-answer follow-up, separate checkout lost-acknowledgement/reload and changed-price review, lost add/remove acknowledgement with later-cart preservation, exact safe-integer currency display, and the busy shop’s native read-only advice followed by an explicit shopper checkout preserving all twenty prior orders. These checks establish SDK/application behavior, not live advice quality or billing. Typecheck and production build also pass; Linux CI repeats these gates.

## Complete source distribution

After installing Chromium, run `npm run check:distribution`. It builds `dist/shopping-assistant-app-0.2.0-source.tar.gz` from application/source/tests/data/docs/lock/CI, extracts into an independent temporary directory, compares every source hash, performs a fresh `npm ci`, initializes all twelve cases through the actual CLI from another working directory, and repeats all checks/typecheck/build/nine production browser flows. On Linux, install browser system dependencies with `npx playwright install --with-deps chromium` first. CI runs the same gate and retains the private source artifact for seven days. Dependencies, private state/receipts and build outputs are excluded. The source archive is a local application distribution, not an npm/public release.

Independent offline qualification is complete; parked gates remain in [PLAN.md](PLAN.md). Live advice requires provider access and human review. Firedrill integration awaits its qualified new release. The repository is private with no selected public license.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.
