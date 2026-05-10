// src/commands/login.js
import chalk from "chalk";
import { execa } from "execa";
import {
  getActiveBackend,
  BACKEND_LABELS,
  setAuthenticated,
  setAnthropicKey,
  getAnthropicKey,
} from "../config.js";
import { BACKENDS, isBackendAvailable } from "../backends/index.js";

const BRAND = "#00CFFF";

export async function loginCommand() {
  const key = getActiveBackend();
  const label = BACKEND_LABELS[key];

  console.log(chalk.dim(`  Backend: ${label}\n`));

  if (key === "quark-agent") {
    const existingKey = getAnthropicKey();
    if (existingKey) {
      console.log(
        chalk.hex(BRAND)("✦ Already configured.") +
          chalk.dim(` API key: sk-...${existingKey.slice(-6)}`)
      );
      return;
    }
    const { default: inquirer } = await import("inquirer");
    const { apiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: "Anthropic API key:",
        validate: (v) => v.trim().length > 10 || "Key required",
      },
    ]);
    setAnthropicKey(apiKey.trim());
    console.log("\n" + chalk.hex(BRAND)("✦ Quark Agent configured."));
    return;
  }

  const def = BACKENDS[key];
  if (!def?.login) {
    console.log(chalk.dim(`  ${label} does not require a separate login step.`));
    return;
  }

  const available = await isBackendAvailable(key);
  if (!available) {
    console.error(
      chalk.red(`✗ ${label} not installed.\n`) +
        chalk.dim(`  Install it first, then run quark login.`)
    );
    process.exit(1);
  }

  const [cmd, args] = def.login;
  try {
    await execa(cmd, args, { stdio: "inherit" });
    setAuthenticated(true);
    console.log("\n" + chalk.hex(BRAND)(`✦ Logged in via ${label}.`));
  } catch (err) {
    console.error(chalk.red("\n✗ Login failed."), chalk.dim(err.message));
    process.exit(1);
  }
}
