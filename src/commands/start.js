// src/commands/start.js
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import {
  getActiveBackend,
  isFallbackEnabled,
  BACKEND_LABELS,
  getAnthropicKey,
} from "../config.js";
import { resolveBackend, BACKENDS } from "../backends/index.js";
import { runAgent } from "../agent/runner.js";

const BRAND = "#00CFFF";

export async function startCommand(opts) {
  const preferred = getActiveBackend();
  const fallback = isFallbackEnabled();

  const spinner = ora({ text: "Resolving backend...", color: "cyan" }).start();
  const { key, label } = await resolveBackend(preferred, fallback);
  spinner.stop();

  if (key !== preferred) {
    console.log(
      chalk.yellow(`  ⚠ ${BACKEND_LABELS[preferred]} not available.`) +
        chalk.dim(` Falling back to ${label}.`)
    );
  } else {
    console.log(chalk.dim(`  Backend: `) + chalk.hex(BRAND)(label));
  }

  const dir = opts.dir || process.cwd();

  if (key === "quark-agent") {
    const apiKey = getAnthropicKey();
    if (!apiKey) {
      console.log(
        chalk.yellow(
          "\n  ⚠ No Anthropic API key. Run quark use and select Quark Agent to set it."
        )
      );
      process.exit(1);
    }
    const { default: inquirer } = await import("inquirer");
    const { task } = await inquirer.prompt([
      {
        type: "input",
        name: "task",
        message: "What should Quark Agent build or do?",
        validate: (v) => v.trim().length > 0 || "Please describe the task",
      },
    ]);
    await runAgent({ task, apiKey, cwd: dir });
    return;
  }

  // External CLI backend
  const def = BACKENDS[key];
  const [cmd, args, spawnOpts = {}] = def.start({ dir });

  console.log(chalk.dim(`  Dir:    ${dir}`));
  console.log(chalk.dim("  Launching...\n"));

  try {
    await execa(cmd, args, {
      stdio: "inherit",
      cwd: dir,
      ...spawnOpts,
    });
  } catch (err) {
    if (err.exitCode !== undefined) process.exit(err.exitCode);
    console.error(chalk.red("✗ Session error:"), chalk.dim(err.message));
    process.exit(1);
  }
}
