# Working rules

Keep the shop synthetic and local. The AI SDK assistant may read catalog, cart and alternatives, but it cannot checkout or add items; shopper controls perform those actions. Enforce budget, stock and product revision checks in the SQLite store, not in model text or client code. Checkout must recheck current stock and leave the cart intact on conflict. Do not describe deterministic cart tests as a live model proof. Add Firedrill only against a qualified new release.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


Checkout now requires a stable request ID and the exact reviewed shop/cart token. Bind instance/cart revision/budget and current line prices/stock/revisions under the transaction; a changed view cannot be purchased silently. Exact request replay returns its original immutable order without touching a newer cart; changed payload under the same ID fails. Preserve legacy orders and unknown request provenance during migration. New DB/WAL state is private, reads use one transaction and totals use safe integer/BigInt arithmetic. Precommit cancellation rolls back all order/cart/stock changes. Keep unresolved browser requests across reload and distinguish recovery from a new order. Model tools must never receive shopper write capabilities. Full cart/data/distribution follow-up remains in PLAN.md; controlled SDK/browser checks do not prove live advice or billing.


Native chat must use the owned explicit Responses provider and locked SDK. Gate raw completion before SDK dispatch; optional item status is valid, contradictory explicit status is not. Keep retries disabled, budgets/abort/recording failures sticky and a completed nonblank final-answer boundary. Preserve original independent usage/unknown fields/failures separately from normalized aggregate SDK counters (v7 usage already aggregates). Record private source/task/initial-final state evidence before dispatch; read-only actual effects stay empty even if shoppers change state concurrently. Never expose write tools. Do not claim ownership of Node's global fetch pool or compressed-wire/hard-memory bounds. See COMPATIBILITY.md for qualified scope.
