# Working rules

Keep the shop synthetic and local. The AI SDK assistant may read catalog, cart and alternatives, but it cannot checkout or add items; shopper controls perform those actions. Enforce budget, stock and product revision checks in the SQLite store, not in model text or client code. Checkout must recheck current stock and leave the cart intact on conflict. Do not describe deterministic cart tests as a live model proof. Add Firedrill only against a qualified new release.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
