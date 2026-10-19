import { join } from 'node:path';
import { ShopStore } from '../lib/store';
import { chatHandler } from '../lib/chat';
const [encoded, db, directory, model] = process.argv.slice(2);
const input = JSON.parse(encoded) as { action: 'chat' | 'inspect'; message: string | null };
const controller = new AbortController();
const stop = () => controller.abort(new Error('Shopping target interrupted.'));
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, stop);
const store = new ShopStore(db, { readOnly: input.action === 'inspect' });
const report: Record<string, unknown> = { executionKind: input.action === 'inspect' ? 'application_state_inspection' : 'native_chat_handler' };
let failed = false;
try {
  report.before = { state: store.state(), orders: store.orders() };
  if (input.action === 'chat') {
    const response = await chatHandler(() => store, { model: model || undefined, outputRoot: join(directory, 'receipts') })(new Request('http://application.local/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ messages: [{ role: 'user', content: input.message }] }),
    }));
    report.http = { status: response.status, body: await response.json() };
    failed = response.status !== 200;
  }
} catch (error) { failed = true; report.error = error instanceof Error ? error.message : String(error); }
finally {
  try { report.after = { state: store.state(), orders: store.orders() }; }
  catch (error) { failed = true; report.stateError = String(error); }
  try { store.close(); report.storeClosed = true; }
  catch (error) { failed = true; report.cleanupError = String(error); }
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(name, stop);
}
console.log(JSON.stringify(report));
if (failed || controller.signal.aborted || report.storeClosed !== true) process.exitCode = 1;
