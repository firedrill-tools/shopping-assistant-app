import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { ApplicationError, commandMain, invokeCLI, privateDirectory } from './adapter-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const cases = new Set(JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url))).cases.map(item => item.id));
export async function runApplication(input, parameters, signal, invocation) {
  if (Object.keys(input).some(key => !['caseId', 'action', 'message'].includes(key)) || !cases.has(input.caseId) || !['chat', 'inspect'].includes(input.action) ||
      (input.action === 'chat' ? typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000 || input.message.includes('\0') : input.message !== null)) throw new Error('Select a reviewed case and chat message or model-free inspection; shopper writes remain separate.');
  const directory = await privateDirectory(root, invocation), db = join(directory, 'shop.db');
  try {
    await invokeCLI([process.execPath, '--import', 'tsx', 'scripts/shop.ts', 'init', '--case', input.caseId, '--db', db], { cwd: root, signal });
    const output = await invokeCLI([process.execPath, '--import', 'tsx', 'firedrill/request.ts', JSON.stringify(input), db, directory, parameters.model ?? ''], { cwd: root, signal });
    return { application: output, localState: { directory, databaseFile: db } };
  } catch (error) { if (error instanceof ApplicationError) error.evidence.runDirectory = directory; throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await commandMain(runApplication);
