# Shopping assistant requirement audit

## Reproduced checkout gaps and current implementation

- An actual ShopStore probe added a mug at observed 2800 cents, changed persisted price/revision to 2900, then checkout silently ordered 2900. Checkout now requires an exact reviewed state/cart revision/price/stock/budget token; changed conditions require review before a new request.
- Repeating checkout after another product was added created a new order for that later cart. Stable request IDs now bind the original cart token and immutable order; exact replay reads the original order and current state without another stock decrement or clearing the newer cart. Reusing the ID with another token fails. A distinct shop instance has a distinct identity even when its visible cart matches.
- Store state is read under one SQLite transaction; safe integer/BigInt arithmetic, private new DB/WAL modes, bounded busy waits, cart/product revisions and precommit guards preserve atomic state. Serialized migration retains populated legacy orders/lines/timestamps without invented request bindings.
- Fourteen domain/actual HTTP checks exercise changed prices, exact/changed intent, separate connections/instances, rollback, lost post-commit acknowledgement, strict request shape, private files and legacy state. Original stock/budget/substitution/persistence checks remain. The browser retains unresolved checkout identity in session storage, restores it after reload and distinguishes recovering an existing order from placing another.

## Completed native checkpoint

The actual AI SDK 7.0.141/OpenAI 4.0.94 Responses loop now gates original completion before tool dispatch, retains private raw measurements/failures separately from normalized usage, and requires terminal successful text. Per-run deadline/abort/readers/receipt ownership, zero retry, four-request/24-tool limits and sticky recording/tool-budget failures are qualified. Optional item metadata remains accepted. The run does not claim to close Node's shared fetch pool. See COMPATIBILITY.md for exact limits.

The initial native checkpoint at 7c6b58f passed all 46 checks and five Chromium flows in Linux CI (run 38854722121). The new bag checkpoint passes 57 checks (25 domain/HTTP/concurrency/currency + 32 native) and eight production browser flows locally; verify its exact-head CI. Browser cases use the actual Next route/AI SDK/read tools and controlled local provider HTTP: complete four-response advice, outage/unfinished-item recovery, and a longer assistant reply followed by another shopper question. Five separate shopper flows preserve checkout proof and qualify bag recovery/exact currency. No paid model was called. Verify exact-head Linux CI/catalog when publishing this checkpoint.

## Independent qualification complete

Application 0.2.0 now includes twelve deterministic hash-bound cases/four profiles, exclusive private list/init/show CLI, complete source provenance and a fresh locked source distribution gate. All 115 automated checks and nine production browser flows pass. The archive independently installs dependencies, initializes every case through the real CLI and repeats native/domain/source checks, typecheck/build and production browser paths outside checkout. Verify exact-head Linux CI/catalog for this checkpoint. No live model or public release is claimed.

Continue the portfolio with #22/#27/#31/#36/#40, then Wave3. User-dependent external gates stay parked below.

## Parked external gates

Owner-supplied OpenAI model/key/budget and human advice review, the new official Firedrill release/contract and persisted scenarios, publication and licensing. This private synthetic shop has no real payment, shipping, inventory or commerce connector. No retired/guessed Firedrill interface.


## Reproduced native baseline evidence (fixed above)

Actual ai 7.0.141 / @ai-sdk/openai 4.0.94 through createOpenAI.responses with its public controlled fetch seam:

- Top response status incomplete/failed/absent with no incomplete_details still dispatched viewCart and released the later final answer. A completed top response carrying an incomplete function item also dispatched the read. The new gate checks original provider metadata before SDK tool dispatch; preserve documented optional item fields rather than narrowing the app to a fabricated response shape.
- A genuine incomplete response with incomplete_details.reason=max_output_tokens stopped at one request, zero tool reads, finishReason=length and empty text. The route now requires an explicit successful terminal answer boundary instead of returning HTTP 200 for empty/nonfinal output.
- With 15 and 30 reported tokens across two calls, result.usage and totalUsage both aggregated 45. The issue is provenance, not missing ordinary steps. With original input=10/output=5/total=99, normalized SDK total was 15: retain original independent totals, missing/partial/invalid/zero fields and errors separately, without claiming SDK totals are raw provider evidence.
- These are controlled real SDK HTTP probes, not live OpenAI judgments or billing. The [official function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) and installed provider source are the protocol references. No platform API-key tool is available; provider keys/budget remain parked and no live model was called.


## Reproduced bag update gaps (fixed)

The prior direct add path repeated a quantity (one mug became two) on retry. Replaying remove after a later same-product add deleted the new entry. Stable exact request identity and complete reviewed shop token now bind each shopper command; original effect and cart changes commit together. Recovery returns immutable before/after facts plus current state without reapplying. Changed intent fails, current source changes need review, and precommit cancellation rolls back command/cart/revision. Two competing processes prove one original add and checkout each apply once. Private schema 3 migration preserves existing state; old orders retain unknown request bindings.

Browser lost add/remove acknowledgements survive reload and preserve newer bag entries. Checkout stays disabled until the pending bag request resolves. Safe-integer prices/order acknowledgements preserve the exact final cent using BigInt formatting; the prior cents/100 path rounded MAX_SAFE_INTEGER cents. The interim bag checkpoint passed 57 checks/eight browser flows (CI38855115294); subsequent complete-source and distribution qualification is recorded below.


## Reproduced complete-source gap (fixed)

An actual persisted source probe accepted an order with total1 versus line2800, missing line fields and an invalid time. The owned schema/catalog/cart/order/command validator now rejects malformed/unsafe/extra/missing/contradictory source before reads or actions, and validates before commit to roll back new invalid state. Known schema0/2 migration preserves source; invalid existing schema3/catalog/identity is not silently healed. Original history retains IDs/text/prices/times and unknown request provenance; retired products/revision gaps remain honest, and stock/budget conflicts remain inspectable for explicit removal. Consecutive revisions enforce original checkout stock/price/name continuity.

Ninety-one checks (58 domain/source/history + 33 actual native SDK), typecheck, production build and eight Chromium flows pass locally. Source failure after final provider prose now saves a failed receipt and returns no successful answer. Source validation has bounded local product/order/command history limits recorded in COMPATIBILITY.md. That source-only checkpoint preceded the complete data/distribution follow-up below; external gates stay parked.


## Data, CLI and distribution checkpoint

Twelve cases/four profiles cover starter, busy, ambiguous names, budget-exact, over-budget, stock-changed, no-alternative, free-item, safe-money, revision-limit, quoted-instructions and prior-orders. The busy case has 48 products/five active lines/twenty original synthetic human orders. Case generation is byte deterministic; strict original hashes/rows/coherence are checked before publication. Optional schema3 metadata preserves source/manifest hashes and imported IDs, with unknown original request identity retained rather than fabricated native provenance. Actual native reads on busy/quoted/conflict cases preserve all state and exclude hidden human task/focus from prompts. Source content remains untrusted.

Exclusive private initialization stages/validates/closes a complete DB before atomic link, refuses existing DB/sidecars/links, preserves uncertain publication and cleans only owned staging. Read-only key-free show never creates/migrates source. The production UI derives counts/categories from actual source; the busy dataset required replacing the original fixed six-piece labels with actual catalog counts/categories. Nine Chromium flows include that busy read-only advice and explicit new order159 with all twenty prior orders unchanged.

Complete deterministic source archive independently installs the lock, resolves actual SDK from the extracted workspace, initializes every case through CLI from another directory, and repeats 115 checks/typecheck/build/nine production browser flows. CI retains a private artifact; no npm/public release. Exact-head CI/catalog remain the final delivery gate for this checkpoint, then continue project #22. Live model/Firedrill/publication remain external.
