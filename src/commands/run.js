// src/commands/run.js
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

export async function runCommand(task, opts) {
  if (!task?.trim()) {
    console.error(chalk.red('✗ Provide a task. Example: quark run "build auth module"'));
    process.exit(1);
  }

  const preferred = getActiveBackend();
  const fallback = isFallbackEnabled();

  const spinner = ora({ text: "Resolving backend...", color: "cyan" }).start();
  const { key, label } = await resolveBackend(preferred, fallback);
  spinner.stop();

  if (key !== preferred) {
    console.log(chalk.yellow(`  ⚠ ${BACKEND_LABELS[preferred]} unavailable.`) + chalk.dim(` Using ${label}.`));
  } else {
    console.log(chalk.dim(`  Backend: `) + chalk.hex(BRAND)(label));
  }

  const dir = opts.dir || process.cwd();
  console.log(chalk.dim(`  Task: `) + chalk.white(task));
  console.log(chalk.dim(`  Dir:  ${dir}\n`));

  if (key === "quark-agent") {
    const apiKey = getAnthropicKey();
    if (!apiKey) {
      console.log(chalk.yellow("\n  ⚠ No Anthropic API key. Run quark use to configure."));
      process.exit(1);
    }
    await runAgent({ task, apiKey, cwd: dir });
    return;
  }

  // External backend — pass task via env or args
  const def = BACKENDS[key];
  const taskOpts = def.passTask(task);
  const [cmd, baseArgs, spawnOpts = {}] = def.start({ dir });

  const finalArgs = [...baseArgs, ...(taskOpts.args || [])];
  const finalEnv = { ...process.env, ...(taskOpts.env || {}), ...spawnOpts.env };

  try {
    await execa(cmd, finalArgs, {
      stdio: "inherit",
      cwd: dir,
      env: finalEnv,
    });
  } catch (err) {
    if (err.exitCode !== undefined) process.exit(err.exitCode);
    console.error(chalk.red("✗ Run error:"), chalk.dim(err.message));
    process.exit(1);
  }
}
