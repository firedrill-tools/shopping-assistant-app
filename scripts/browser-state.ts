/** Reset only an owned ignored browser-test destination, before its server starts. */
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { initializeCase } from "../lib/datasets";
const selected = process.argv[2] ?? "starter";
if (!["starter", "busy"].includes(selected))
  throw new Error("Only owned starter/busy browser state may reset here");
const root = resolve(".e2e");
mkdirSync(root, { recursive: true, mode: 0o700 });
const path = resolve(root, selected === "starter" ? "shop.db" : "busy.db");
for (const suffix of ["", "-wal", "-shm", "-journal"])
  rmSync(path + suffix, { force: true });
initializeCase(selected, path);
