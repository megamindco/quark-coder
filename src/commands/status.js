// src/commands/status.js
import chalk from "chalk";
import { store, getActiveBackend, BACKEND_KEYS, BACKEND_LABELS, getAnthropicKey } from "../config.js";
import { probeAllBackends } from "../backends/index.js";
import ora from "ora";

const BRAND = "#00CFFF";

export async function statusCommand() {
  const spinner = ora({ text: "Probing backends...", color: "cyan" }).start();
  const availability = await probeAllBackends();
  spinner.stop();

  const active = getActiveBackend();

  console.log(chalk.hex(BRAND).bold("\nQuark Status\n"));

  // Backends table
  console.log(chalk.dim("  Backends:"));
  for (const key of BACKEND_KEYS) {
    const ok = availability[key];
    const isActive = key === active;
    const dot = ok ? chalk.hex(BRAND)("✦") : chalk.dim("○");
    const name = isActive
      ? chalk.hex(BRAND)(BACKEND_LABELS[key])
      : ok
      ? chalk.white(BACKEND_LABELS[key])
      : chalk.dim(BACKEND_LABELS[key]);
    const tag = isActive ? chalk.hex(BRAND)(" ← active") : "";
    const notFound = !ok && key !== "quark-agent" ? chalk.dim(" (not installed)") : "";
    console.log(`    ${dot} ${name}${tag}${notFound}`);
  }

  // Quark Agent key
  const apiKey = getAnthropicKey();
  console.log();
  console.log(chalk.dim("  Quark Agent:"));
  if (apiKey) {
    console.log(`    ${chalk.hex(BRAND)("✦")} Anthropic key ${chalk.dim("sk-..." + apiKey.slice(-6))}`);
  } else {
    console.log(`    ${chalk.dim("○")} No API key — run ${chalk.hex(BRAND)("quark use")} to configure`);
  }

  // Fallback state
  const fallback = store.get("fallbackEnabled");
  console.log();
  console.log(chalk.dim("  Fallback:"), fallback ? chalk.hex(BRAND)("enabled") : chalk.dim("disabled"));

  // Node + config
  console.log(chalk.dim("  Node:   "), chalk.dim(process.version));
  console.log(chalk.dim("  Config: "), chalk.dim(store.path));
  console.log();
}
