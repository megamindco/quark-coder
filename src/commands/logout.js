// src/commands/logout.js
import chalk from "chalk";
import { execa } from "execa";
import { getActiveBackend, BACKEND_LABELS, clearAuth } from "../config.js";
import { BACKENDS } from "../backends/index.js";

export async function logoutCommand() {
  const key = getActiveBackend();
  const def = BACKENDS[key];

  if (def?.logout) {
    const [cmd, args] = def.logout;
    try {
      await execa(cmd, args, { stdio: "inherit" });
    } catch {
      // non-fatal
    }
  }

  clearAuth();
  console.log(chalk.dim(`\n  ${BACKEND_LABELS[key]} session cleared.`));
}
