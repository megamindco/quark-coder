// src/commands/super.js
import chalk from "chalk";
import inquirer from "inquirer";
import {
  getAgentProvider, getAgentModel,
  getProviderKey, setProviderKey, setAgentModel,
} from "../config.js";
import { PROVIDERS } from "../agent/providers.js";
import { runSuperAgent } from "../agent/super/runner.js";
import { initPool, listAgents, addAgent, getPoolPath } from "../agent/super/pool.js";

const BRAND = "#00CFFF";
const GREEN  = "#39D353";

// ── Pool status display ────────────────────────────────────────────────────
function showPool() {
  initPool();
  const agents = listAgents();
  console.log(chalk.hex(BRAND).bold("\n  ⬡ Super Quark — Agent Pool\n"));
  console.log(chalk.dim("  Location: ") + chalk.white(getPoolPath()));
  console.log(chalk.dim("  Agents:   ") + chalk.white(agents.length) + "\n");
  for (const a of agents) {
    const score = a.performance?.avg_watchdog_score;
    const sessions = a.performance?.sessions_completed || 0;
    const dot = score == null ? chalk.dim("○")
              : score >= 0.85 ? chalk.hex(GREEN)("✦")
              : score >= 0.6  ? chalk.hex("#F0C040")("◈")
              : chalk.red("✗");
    const scoreStr = score != null
      ? chalk.dim(`  ${score.toFixed(2)} avg · ${sessions} session${sessions !== 1 ? "s" : ""}`)
      : chalk.dim("  new");
    console.log(`  ${dot} ${chalk.white(a.role)}${scoreStr}`);
    console.log(chalk.dim(`    ${(a.capability_keys || []).slice(0, 7).join(", ")}`));
  }
  console.log();
}

// ── Interactive pool-add ───────────────────────────────────────────────────
async function interactivePoolAdd() {
  console.log(chalk.hex(BRAND).bold("\n  ⬡ Add Agent to Pool\n"));

  const answers = await inquirer.prompt([
    {
      type: "input", name: "role",
      message: "Role name (e.g. GraphQL Specialist):",
      validate: v => v.trim().length > 2 || "Required",
    },
    {
      type: "input", name: "role_slug",
      message: "Role slug (e.g. graphql-specialist):",
      validate: v => /^[a-z0-9-]+$/.test(v.trim()) || "Lowercase letters, numbers, hyphens only",
    },
    {
      type: "input", name: "capability_keys",
      message: "Capability keys (comma-separated, e.g. graphql,apollo,schema):",
      validate: v => v.trim().length > 0 || "Required",
    },
    {
      type: "input", name: "description",
      message: "One-sentence description:",
      validate: v => v.trim().length > 5 || "Required",
    },
    {
      type: "input", name: "system_prompt_delta",
      message: "System prompt instructions (leave blank for none):",
    },
  ]);

  const agent = addAgent({
    role: answers.role.trim(),
    role_slug: answers.role_slug.trim(),
    capability_keys: answers.capability_keys.split(",").map(k => k.trim()).filter(Boolean),
    description: answers.description.trim(),
    system_prompt_delta: answers.system_prompt_delta.trim(),
    preferred_tools: ["execute_bash", "mcp_create_file", "mcp_bulk_file_writer", "mcp_view_file", "mcp_search_replace"],
    watchdog_defaults: { min_output_length: 150, required_signals: [] },
  });

  console.log(chalk.hex(GREEN)(`\n  ✦ Agent added: ${agent.role}`));
  console.log(chalk.dim(`  Slug: ${agent.role_slug}`));
  console.log(chalk.dim(`  Keys: ${agent.capability_keys.join(", ")}\n`));
}

// ── Resolve model with custom support ─────────────────────────────────────
async function resolveModel(opts, providerDef) {
  let model = opts.model;

  // "--model custom" or "--pick-model" → interactive selector
  if (model === "custom" || opts.pickModel) {
    const choices = [
      ...providerDef.models.map(m => ({ name: m, value: m })),
      { name: chalk.dim("Other — type any model string"), value: "__custom__" },
    ];
    const saved = getAgentModel() || providerDef.defaultModel;
    const { picked } = await inquirer.prompt([{
      type: "list", name: "picked",
      message: "Select model for Generator + all sub-agents:",
      choices, default: saved,
    }]);
    if (picked === "__custom__") {
      const { custom } = await inquirer.prompt([{
        type: "input", name: "custom",
        message: "Model string (any valid identifier for this provider):",
        default: saved,
        validate: v => v.trim().length > 0 || "Required",
      }]);
      model = custom.trim();
    } else {
      model = picked;
    }
    setAgentModel(model);
    console.log(chalk.dim(`  Model locked: ${model}\n`));
  }

  return model || getAgentModel() || providerDef.defaultModel;
}

// ── Main command ───────────────────────────────────────────────────────────
export async function superCommand(task, opts) {

  // Pool inspection flags — no LLM needed
  if (opts.poolStatus) { showPool(); return; }
  if (opts.poolAdd)    { initPool(); await interactivePoolAdd(); return; }

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
      validate: v => v.trim().length > 10 || "Key required",
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
      message: "Task for Super Quark Agent:",
      validate: v => v.trim().length > 0 || "Describe what to build or do",
    }]);
    finalTask = input;
  }

  try {
    await runSuperAgent({
      task: finalTask,
      provider,
      apiKey,
      model,
      cwd: opts.dir || process.cwd(),
    });
  } catch (err) {
    console.error(chalk.red(`\n  ✗ Super Agent failed: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}
