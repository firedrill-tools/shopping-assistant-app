# Qualified shopping runtime

## Actual native path

Node.js 24, Next.js 16.4.1, `ai` 7.0.141, `@ai-sdk/openai` 4.0.94 and Zod 4.6.7 are locked. `createOpenAI(...).responses(model)` and `generateText` perform native JSON Responses requests and execute the three actual read tools. Upgrading the AI SDK/provider requires requalification; the runtime checks their installed versions. Model/key are account-owned configuration. No default or live model result is implied by synthetic test IDs.

Per-run ownership includes an abort controller, parent listener, overall deadline (at most 120 seconds), HTTP deadlines (30 seconds), response readers and receipt queue. Finally closes the run, clears its timer, removes its listener and aborts owned provider operations. Uncooperative late fetch responses are cancelled without running tools or changing the final receipt. Stream cancellation cannot keep the run waiting for an uncooperative underlying cancel promise. The global fetch connection pool belongs to Node/the injected caller, not this run; there is no claimed private pool shutdown.

Limits: no SDK retry, four prepared HTTP requests/SDK steps, 24 tool invocations, 2048 requested output tokens, 1 MiB provider request and captured decoded response, twelve history messages (2000 user/64000 assistant characters), and at most 64000 characters in a final reply. The HTTP input limit is checked after buffering; the decoded stream capture bounds retained evidence, not compressed wire traffic or total process memory. These are local execution bounds, not a provider billing guarantee.

## Completion and authority

Before returning any original JSON body to the SDK, require completed top-level status, absent error/incomplete details, response/model identities, unique response/tool IDs, supported output types, strict known read-tool arguments and completed explicit item statuses. Documented omitted item statuses remain valid. Refusal, commentary alone, malformed/oversized JSON, unfinished metadata and unsupported writes cannot dispatch reads or release a successful final answer. Terminal success additionally requires an actual nonblank SDK stop answer with no pending tool call. Tool/recording failures latch even when the SDK represents a tool exception as an ordinary tool result.

Only `searchProducts`, `viewCart` and `suggestAlternatives` are exposed. They query actual persisted products/cart. Only shopper controls own add/remove/checkout. Model prose cannot reserve inventory or place orders. The local demo has one cart, no authentication, no external inventory/payment/shipping and no multi-user commerce claim. Opaque state tokens bind reviewed facts; they are not credentials.

## Evidence and measurement

Each run records private initial/final source snapshots, task/instruction hashes, requested/returned model IDs, package versions, actual tool reads/results, original request/decoded response bodies, HTTP/request/response IDs, hashes, unknown fields, failures and lifecycle. Receipt directories/files are newly 0700/0600; existing parent modes are preserved. Atomic unique files are flushed before replacement; writes serialize across parallel tools. A recording failure prevents further work and returns failure. If final recording fails, the last durable file can remain running; in-memory evidence is failed, and the API must not claim a completed result.

Original input/output/total counters are independently retained and aggregated only when all prepared attempts report a valid safe integer for that field. Missing, invalid and partial counters remain unknown; zero remains zero. SDK normalized per-step and aggregate usage are stored separately. AI SDK v7 already aggregates ordinary steps in `result.usage`; no last-step-only loss is claimed. Original total 99 with input 10/output 5 remains 99 even when the SDK normalizes total to 15. Cost remains null. Read-only model effects remain empty; unrelated shopper changes observed between snapshots are not attributed to the assistant.

## Reproducible offline proof

`npm test`: 46 checks (14 domain/HTTP and 32 native SDK/protocol/ownership/measurement checks). `npm run typecheck` and production build pass. Five production Chromium flows cover the real browser → Next route → actual AI SDK → controlled local Responses server → actual read tools, visible provider/unfinished-item failure and recovery, long-answer follow-up, and the separate shopper checkout recovery/stale-price flows. Controlled HTTP runs require no paid key, account or network model execution. CI repeats these paths on Linux.

The native baseline exposed unfinished provider metadata reaching tools, empty nonfinal success and loss of raw measurement provenance. Tests exercise actual SDK behavior instead of replacing the application loop. Official protocol references: [function calling](https://developers.openai.com/api/docs/guides/function-calling) and [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses), plus installed locked SDK source.

## Remaining qualification

Full cart add/remove request identity/concurrency, strict complete imported history, richer deterministic datasets/CLI and outside-checkout source distribution remain tracked in PLAN.md. Live advice quality/cost require an owner-enabled model/key/budget and human review. Firedrill requires its qualified official new release/contract and persisted scenarios; no retired or invented interface is used. Publication and licensing are undecided; repository remains private.
