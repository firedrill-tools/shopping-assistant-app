# Shopping assistant requirement audit

## Reproduced checkout gaps and current implementation

- An actual ShopStore probe added a mug at observed 2800 cents, changed persisted price/revision to 2900, then checkout silently ordered 2900. Checkout now requires an exact reviewed state/cart revision/price/stock/budget token; changed conditions require review before a new request.
- Repeating checkout after another product was added created a new order for that later cart. Stable request IDs now bind the original cart token and immutable order; exact replay reads the original order and current state without another stock decrement or clearing the newer cart. Reusing the ID with another token fails. A distinct shop instance has a distinct identity even when its visible cart matches.
- Store state is read under one SQLite transaction; safe integer/BigInt arithmetic, private new DB/WAL modes, bounded busy waits, cart/product revisions and precommit guards preserve atomic state. Serialized migration retains populated legacy orders/lines/timestamps without invented request bindings.
- Fourteen domain/actual HTTP checks exercise changed prices, exact/changed intent, separate connections/instances, rollback, lost post-commit acknowledgement, strict request shape, private files and legacy state. Original stock/budget/substitution/persistence checks remain. The browser retains unresolved checkout identity in session storage, restores it after reload and distinguishes recovering an existing order from placing another.

## Independent tasks in progress

1. Two production Chromium flows now pass: lost acknowledgement/reload/exact original-order recovery preserves a newer bag, and changed price rejects stale consent until the shopper reviews the fresh amount. Verify exact-head CI/catalog before advancing the checkpoint. These are synthetic shopper flows, not paid model results.
2. Audit full cart command intent/idempotency and concurrent original-request recovery, strict complete product/cart/order schemas and safe coherent imported history. Preserve shopper-only add/checkout authority; model tools remain read-only.
3. Qualify actual Vercel AI SDK/OpenAI Responses completion before reads/final answer, bounded retries/requests/output/cleanup/cancellation, original raw all-step usage/failures, durable private task/state/receipt evidence and model/task source scope. Current module-global openai, completion/ownership and raw all-step measurement provenance remain unqualified. Actual AI SDK v7 result.usage already aggregates steps; do not describe it as a last-step-only counter. Controlled SDK HTTP is not live model judgment.
4. Add deterministic hash-bound starter/busy/ambiguous/boundary catalog/cart/order cases, exclusive private initialization/reset, honest human order history and selected task focus excluded from prompts. No fake provider trials or reference-answer matching for advice.
5. Exercise actual production model chat/negative/recovery and shopper boundaries in Chromium. Verify fresh locked source archive outside checkout, all installed cases, real cart/order operations and UI/native paths as needed, then exact-head CI/catalog. Continue #22/#27/#31/#36/#40 and Wave 3 afterward.

## Parked external gates

Owner-supplied OpenAI model/key/budget and human advice review, the new official Firedrill release/contract and persisted scenarios, publication and licensing. This private synthetic shop has no real payment, shipping, inventory or commerce connector. No retired/guessed Firedrill interface.


## Native baseline evidence for the next pass

Actual ai 7.0.141 / @ai-sdk/openai 4.0.94 through createOpenAI.responses with its public controlled fetch seam:

- Top response status incomplete/failed/absent with no incomplete_details still dispatched viewCart and released the later final answer. A completed top response carrying an incomplete function item also dispatched the read. Gate original provider metadata before SDK tool dispatch; preserve documented optional item fields rather than narrowing the app to a fabricated response shape.
- A genuine incomplete response with incomplete_details.reason=max_output_tokens stopped at one request, zero tool reads, finishReason=length and empty text. The route still needs an explicit successful terminal answer boundary instead of returning HTTP 200 for empty/nonfinal output.
- With 15 and 30 reported tokens across two calls, result.usage and totalUsage both aggregated 45. The issue is provenance, not missing ordinary steps. With original input=10/output=5/total=99, normalized SDK total was 15: retain original independent totals, missing/partial/invalid/zero fields and errors separately, without claiming SDK totals are raw provider evidence.
- These are controlled real SDK HTTP probes, not live OpenAI judgments or billing. The [official function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) and installed provider source are the protocol references. No platform API-key tool is available; provider keys/budget remain parked and no live model was called.
