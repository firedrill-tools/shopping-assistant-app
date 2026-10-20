# Simulate this agent with Firedrill

Firedrill is a simulation platform for AI agents. Your coding agent can prepare
and operate these simulations; the application and its model run in your own
repository or CI.

Start in the repository root, not inside `firedrill/`:

```sh
npx firedrill-run init
```

Authorize Firedrill and select a project/environment. Installation choices are
optional; skip them when using the locked `firedrill/` toolchain below. This setup
does not invoke the target agent or grant it access to real business accounts.

The optional toolchain pins released `@firedrill-run/cli` and `@firedrill-run/sdk` **2.2.2** (October 19, 2026), Node 22+. The app retains its locked Next.js, AI SDK, OpenAI and SQLite dependencies.

## Prepare and run

From the repository root:

```sh
npm ci
npm ci --prefix firedrill --ignore-scripts --no-audit --no-fund
node firedrill/node_modules/@firedrill-run/cli/bin/firedrill.mjs validate firedrill/scenario.json --json --non-interactive
```

Validation is offline. In a human terminal, use `npx firedrill-run init` to authorize/select the actual project/environment. Automation uses protected `FIREDRILL_TOKEN`, `FIREDRILL_PROJECT_ID`, `FIREDRILL_ENVIRONMENT_ID`. Model operations independently need `OPENAI_API_KEY` and an enabled `OPENAI_MODEL` or recipe model parameter. Do not put credentials in recipes.

After scope and provider budget are authorized:

```sh
node firedrill/simulate.mjs --preview
node firedrill/simulate.mjs
```

The bounded sequential recipe initializes an actual hash-bound private shop DB and calls the application's normal `chatHandler` Web Request/Response callable and native AI SDK Responses loop. This is the same handler used by `/api/chat`, with its real store/provider and no injected model/client. Starter and ambiguous-name chat cases call the model; busy inspection reads actual 48-product/five-line/twenty-order state without inference. This callable check does not claim a hosted Next.js request or browser UI flow; existing production browser gates remain in place.

The model receives only existing read tools. Adding/removing items, checkout, shopper command IDs, review tokens and budget/stock mutations are not adapter actions. Human shopper actions and existing transaction/precondition checks remain authoritative. Provider final prose is not a purchase/reservation or factual quality assessment. Only the explicit bounded message is supplied; fixture focus/expected outcomes and outer invocation IDs do not enter model context.

Every attempt first saves validated run/attempt/scenario identity in private `.runs/firedrill/attempt-*/invocation.json`, then initializes its own private SQLite DB. Native receipts and actual before/after state are retained, including model-key failures; failure is nonzero even if the HTTP handler returned a readable error. The store is closed in `finally`. Existing request/output/tool/deadline/abort/recording guards remain in effect, without a remote cancellation/billing or rollback claim. New attempts never reset prior DBs or evidence. Operator/CI credentials are removed before child dispatch; current ID-only invocation rejects controller data and unsupported Tool bindings. Paths are local files, not uploaded platform artifacts.

## MCP and recovery

Configure remote OAuth operator MCP at **https://mcp.firedrill.run/mcp** using [host setup](https://docs.firedrill.run/guides/coding-agents). MCP prepares, queues and inspects; the local SDK/CLI executes the command target. Host OAuth and execution login are separate. Use `--run BATCH_ID` to attach queued work, `--resume OPERATION_ID` after uncertainty, and `--result BATCH_ID` to read retained results. Preserve SDK journals and local evidence. These scripts retain public SDK diagnostics and whole-batch exit status; a new simulation starts new work.

CI and the fresh locked source archive run offline integration tests with actual private shop inspection and the normal chat-handler missing-key boundary. They establish wiring and cleanup, not live model quality, platform persistence, or uploaded captures. The observation recipe defines no grader/gate. Authenticated persisted happy/negative runs, paid model quality/cost, publication and licensing remain separate gates.

References: [SDK](https://docs.firedrill.run/sdk/typescript), [command targets](https://docs.firedrill.run/guides/callbacks), [operator MCP](https://docs.firedrill.run/guides/control-mcp), [CI](https://docs.firedrill.run/guides/ci).

## Offline verification

After installing the application dependencies and locked integration toolchain,
run `npm test --prefix firedrill` to exercise the adapter checks. These checks are
optional for first use and call no paid model. The Node 22+ requirement above is
for the Firedrill clients; it does not lower any application runtime requirement
in the root README.
