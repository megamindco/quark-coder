// src/commands/agent.js
import chalk from "chalk";
import inquirer from "inquirer";
import {
  getAgentProvider, getAgentModel, setAgentModel,
  getProviderKey, setProviderKey,
} from "../config.js";
import { PROVIDERS } from "../agent/providers.js";
import { runAgent } from "../agent/runner.js";

const BRAND = "#00CFFF";

// ── Resolve model: --model custom → interactive prompt, --list-models → picker
async function resolveModel(opts, providerDef) {
  // --list-models: show full picker
  if (opts.listModels || opts.model === "custom") {
    const choices = [
      ...providerDef.models.map(m => ({ name: m, value: m })),
      { name: chalk.dim("Other — type any model string"), value: "__custom__" },
    ];
    const saved = getAgentModel() || providerDef.defaultModel;
    const { picked } = await inquirer.prompt([{
      type: "list", name: "picked",
      message: `Select model for ${providerDef.label}:`,
      choices, default: saved,
    }]);
    if (picked === "__custom__") {
      const { custom } = await inquirer.prompt([{
        type: "input", name: "custom",
        message: "Model string:",
        default: saved,
        validate: v => v.trim().length > 0 || "Required",
      }]);
      setAgentModel(custom.trim());
      return custom.trim();
    }
    setAgentModel(picked);
    return picked;
  }

  // --model <explicit string>: use directly (supports any model ID)
  if (opts.model) return opts.model;

  // Default: fall back to saved or provider default
  return getAgentModel() || providerDef.defaultModel;
}

export async function agentCommand(task, opts) {
  // ── Provider ─────────────────────────────────────────────────────────────
  const provider = opts.provider || getAgentProvider() || "anthropic";
  const providerDef = PROVIDERS[provider];
  if (!providerDef) {
    console.error(chalk.red(`✗ Unknown provider: ${provider}`));
    console.log(chalk.dim("  Valid: " + Object.keys(PROVIDERS).join(", ")));
    process.exit(1);
  }

  // ── API key ───────────────────────────────────────────────────────────────
  let apiKey = getProviderKey(provider);
  if (!apiKey) {
    console.log(chalk.yellow(`\n  ⚠ No API key for ${providerDef.label}.\n`));
    const { key } = await inquirer.prompt([{
      type: "password", name: "key",
      message: `${providerDef.keyName}:`,
      validate: v => v.trim().length > 10 || "Required",
    }]);
    apiKey = key.trim();
    setProviderKey(provider, apiKey);
    console.log(chalk.dim("  Key saved.\n"));
  }

  // ── Model ─────────────────────────────────────────────────────────────────
  const model = await resolveModel(opts, providerDef);

  // ── Task ──────────────────────────────────────────────────────────────────
  let finalTask = task;
  if (!finalTask?.trim()) {
    const { input } = await inquirer.prompt([{
      type: "input", name: "input",
      message: "Task:",
      validate: v => v.trim().length > 0 || "Describe the task",
    }]);
    finalTask = input;
  }

  await runAgent({
    task: finalTask,
    apiKey,
    provider,
    model,
    cwd: opts.dir || process.cwd(),
  });
}
