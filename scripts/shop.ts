import { initializeCase, loadManifest, showCase } from "../lib/datasets";
function options(args: string[]) {
  const output: Record<string, string> = {};
  while (args.length) {
    const key = args.shift()!,
      value = args.shift();
    if (
      !["--case", "--db", "--data-root"].includes(key) ||
      !value ||
      value.startsWith("--") ||
      Object.hasOwn(output, key)
    )
      throw new Error("Use unique --case/--db/--data-root options with values");
    output[key] = value;
  }
  return output;
}
try {
  const [command, ...args] = process.argv.slice(2),
    config = options(args);
  let result;
  if (
    (command === "--help" || command === "help") &&
    args.length === 0 &&
    Object.keys(config).length === 0
  )
    result = {
      usage:
        "npm run shop -- cases [--data-root data] | init --case CASE --db NEW_PATH [--data-root data] | show --db EXISTING_PATH",
    };
  else if (command === "cases" && !config["--case"] && !config["--db"])
    result = loadManifest(config["--data-root"]).manifest;
  else if (command === "init" && config["--case"] && config["--db"])
    result = initializeCase(
      config["--case"],
      config["--db"],
      config["--data-root"],
    );
  else if (
    command === "show" &&
    config["--db"] &&
    !config["--case"] &&
    !config["--data-root"]
  )
    result = showCase(config["--db"]);
  else
    throw new Error(
      "Usage: npm run shop -- cases [--data-root data] | init --case CASE --db NEW_PATH [--data-root data] | show --db EXISTING_PATH",
    );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : String(error)) + "\n",
  );
  process.exitCode = 1;
}
