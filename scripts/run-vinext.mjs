import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/run-vinext.mjs <dev|build|start> [...args]");
  process.exit(2);
}

const child = spawn(process.execPath, [cli, command, ...args], {
  cwd: root,
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: path.join(root, ".wrangler", "wrangler.log"),
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to start Vinext: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
