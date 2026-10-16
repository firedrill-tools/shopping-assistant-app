import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".e2e");
mkdirSync(root, { recursive: true, mode: 0o700 });
for (const suffix of ["", "-wal", "-shm"])
  rmSync(resolve(root, `shop.db${suffix}`), { force: true });
