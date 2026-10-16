# Working rules

Keep the shop synthetic and local. The AI SDK assistant may read catalog, cart and alternatives, but it cannot checkout or add items; shopper controls perform those actions. Enforce budget, stock and product revision checks in the SQLite store, not in model text or client code. Checkout must recheck current stock and leave the cart intact on conflict. Do not describe deterministic cart tests as a live model proof. Add Firedrill only against a qualified new release.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


Checkout now requires a stable request ID and the exact reviewed shop/cart token. Bind instance/cart revision/budget and current line prices/stock/revisions under the transaction; a changed view cannot be purchased silently. Exact request replay returns its original immutable order without touching a newer cart; changed payload under the same ID fails. Preserve legacy orders and unknown request provenance during migration. New DB/WAL state is private, reads use one transaction and totals use safe integer/BigInt arithmetic. Precommit cancellation rolls back all order/cart/stock changes. Keep unresolved browser requests across reload and distinguish recovery from a new order. Model tools must never receive shopper write capabilities. Independent data/CLI/distribution qualification and parked gates are recorded in PLAN.md; controlled SDK/browser checks do not prove live advice or billing.


Native chat must use the owned explicit Responses provider and locked SDK. Gate raw completion before SDK dispatch; optional item status is valid, contradictory explicit status is not. Keep retries disabled, budgets/abort/recording failures sticky and a completed nonblank final-answer boundary. Preserve original independent usage/unknown fields/failures separately from normalized aggregate SDK counters (v7 usage already aggregates). Record private source/task/initial-final state evidence before dispatch; read-only actual effects stay empty even if shoppers change state concurrently. Never expose write tools. Do not claim ownership of Node's global fetch pool or compressed-wire/hard-memory bounds. See COMPATIBILITY.md for qualified scope.


All HTTP add/remove retries must use strict `ShopStore.command` with stable request ID and complete reviewed shop token. Record immutable effect and cart/revision together; exact recovery reads original effect/current state before fresh-precondition checks, changed intent fails, and a delayed remove must preserve a later same-product entry. Local add/remove helpers are fresh explicit operations, not retry APIs. Persist unresolved browser commands before dispatch and require their resolution before new cart writes/checkout. Preserve exact BigInt minor-unit formatting.


Validate owned schema and complete coherent source/history at open, around transactions and on independent reads. Preserve original order lines/IDs/times/prices and unknown legacy request provenance. Reject invalid existing source without reseeding/repair, including hidden triggers/extra tables/columns and malformed command effects. Retired historic products/revision gaps may be valid; do not invent intervening operations. Consecutive revisions must match prior checkout stock/price/name continuity. Changed-source stock/budget conflicts stay inspectable/removable and fail checkout. A failed final source snapshot must save a failed native receipt before returning failure when recording is available. See COMPATIBILITY.md for local size bounds.


Data source authority is fixtures/base.json → scripts/generate_data.py → twelve LF/hash-bound data cases/manifest. Keep synthetic human order history coherent and original request IDs unknown; never invent native runs/usage. Optional dataset metadata is a strict original-seed provenance contract, not the current mutable state or model prompt. Human task/focus must stay out of implicit model context. Initialization publishes only complete private new DBs exclusively, refuses existing DB/sidecars/links and preserves uncertain publication; never reset another destination. Read-only show must not create/migrate/mutate source. Include all code/data/docs/tests/config/lock/CI in the source archive, exclude private/generated state and verify the full fresh locked install/CLI/native/browser gates outside checkout. The browser reset helper may remove only its explicitly owned ignored starter/busy test destinations before their servers start.
