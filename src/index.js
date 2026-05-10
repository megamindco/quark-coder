#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";
import figlet from "figlet";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { loginCommand }  from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { startCommand }  from "./commands/start.js";
import { runCommand }    from "./commands/run.js";
import { statusCommand } from "./commands/status.js";
import { useCommand }    from "./commands/use.js";
import { agentCommand }  from "./commands/agent.js";
import { superCommand }  from "./commands/super.js";
import { getActiveBackend, BACKEND_LABELS, getAgentProvider, getAgentModel } from "./config.js";
import { PROVIDERS } from "./agent/providers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
const BRAND = "#00CFFF";

function printBanner() {
  console.log(chalk.hex(BRAND)(figlet.textSync("QUARK", { font: "Small", horizontalLayout: "fitted" })));
  const backend  = BACKEND_LABELS[getActiveBackend()] || "–";
  const provider = PROVIDERS[getAgentProvider()]?.label || getAgentProvider() || "–";
  const model    = getAgentModel() || "default";
  console.log(
    chalk.dim("  MMC · v" + pkg.version) + "  " + chalk.hex(BRAND)("⬡") +
    chalk.dim("  backend: ") + chalk.white(backend) +
    chalk.dim("  agent: ") + chalk.white(provider) + chalk.dim("/") + chalk.white(model)
  );
  console.log();
}

// ── Commands ───────────────────────────────────────────────────────────────

program
  .name("quark")
  .description("Quark — MMC unified AI coding CLI. Multi-backend · multi-provider · DASA Super Agent.")
  .version(pkg.version, "-v, --version")
  .hook("preAction", (cmd) => {
    if (!["status", "use"].includes(cmd.args[0])) printBanner();
  });

program.command("use")
  .description("Configure: backend, provider, API keys, model")
  .action(useCommand);

program.command("login")
  .description("Authenticate with the active backend")
  .action(loginCommand);

program.command("logout")
  .description("Sign out of the active backend")
  .action(logoutCommand);

program.command("start")
  .description("Start an AI coding session with the active backend")
  .option("-d, --dir <path>", "Working directory", process.cwd())
  .action(startCommand);

program.command("run [task]")
  .description("One-shot task via active backend")
  .option("-d, --dir <path>", "Working directory", process.cwd())
  .action(runCommand);

program.command("agent [task]")
  .description("Single-agent mode — one focused role, fast")
  .option("-d, --dir <path>",     "Working directory", process.cwd())
  .option("-p, --provider <p>",   "Provider: anthropic | openrouter | glm")
  .option("-m, --model <m>",      "Model string, or 'custom' for interactive picker")
  .option("--list-models",        "Pick model interactively before running")
  .action(agentCommand);

program.command("super [task]")
  .description("Super Quark Agent — DASA pipeline: Generator → team → Watchdog → Pool write-back")
  .option("-d, --dir <path>",     "Working directory", process.cwd())
  .option("-p, --provider <p>",   "Provider: anthropic | openrouter | glm")
  .option("-m, --model <m>",      "Model string, or 'custom' for interactive picker")
  .option("--pick-model",         "Pick model interactively before running")
  .option("--pool-status",        "Show Agent Pool with scores and exit")
  .option("--pool-add",           "Add a custom agent to the pool interactively")
  .action(superCommand);

program.command("status")
  .description("Show backends, providers, pool, and config")
  .action(statusCommand);

// ── Help ───────────────────────────────────────────────────────────────────

program.addHelpText("after", `
${chalk.dim("Backends (quark start / run):")}
  ${chalk.hex(BRAND)("bonsai")}       Bonsai AI          npm install -g @bonsai-ai/cli
  ${chalk.hex(BRAND)("claude")}       Claude Code        npm install -g @anthropic-ai/claude-code
  ${chalk.hex(BRAND)("gemini")}       Gemini CLI         npm install -g @google/gemini-cli
  ${chalk.hex(BRAND)("opencode")}     OpenCode           npm install -g opencode-ai
  ${chalk.hex(BRAND)("glm")}          Z.ai GLM Code      npm install -g glm-code

${chalk.dim("Providers (quark agent / super):")}
  ${chalk.hex(BRAND)("anthropic")}    Claude — Opus 4, Sonnet 4, Haiku               ANTHROPIC_API_KEY
  ${chalk.hex(BRAND)("openrouter")}   200+ models — Gemini, Grok, DeepSeek, Llama    OPENROUTER_API_KEY
  ${chalk.hex(BRAND)("glm")}          Z.ai GLM & CodeGeeX — codegeex-4, glm-4-plus   GLM_API_KEY

${chalk.dim("GLM models:")}
  codegeex-4   Code-optimised. Tools via XML text-fallback (Anthropic format internally)
  glm-4-plus   Native tool calling
  glm-4-long   128k context, native tool calling
  glm-4-flash  Fast, native tool calling

${chalk.dim("Custom models:")}
  quark agent -m custom          Interactive model picker for current provider
  quark agent -m qwen/qwq-32b    Pass any valid model string directly
  quark super --pick-model        Interactive picker before DASA run

${chalk.dim("Super Quark Agent — DASA pipeline:")}
  Generator     → analyses task, queries Agent Pool, emits Spawn Manifest
  Executor      → runs each agent with scoped context + tools (up to 20 turns each)
  Watchdog P1   → validates each agent output against manifest thresholds
  Watchdog P2   → validates compound coherence across all agent outputs
  Pool write-back → updates agent scores + session learnings

${chalk.dim("Examples:")}
  ${chalk.hex(BRAND)("quark use")}                                     Configure everything
  ${chalk.hex(BRAND)('quark agent "fix the login bug"')}               Single-agent, default provider
  ${chalk.hex(BRAND)('quark agent -p glm -m codegeex-4 "refactor"')}   GLM CodeGeeX single agent
  ${chalk.hex(BRAND)('quark agent -p openrouter -m deepseek/deepseek-r1 "build API"')}
  ${chalk.hex(BRAND)('quark super "build a REST API with auth"')}       Full DASA pipeline
  ${chalk.hex(BRAND)('quark super -p glm -m glm-4-plus "add dark mode"')}
  ${chalk.hex(BRAND)("quark super --pool-status")}                      Agent Pool scores
  ${chalk.hex(BRAND)("quark super --pool-add")}                         Add custom agent to pool
  ${chalk.hex(BRAND)("quark start")}                                    Open Bonsai/Claude/Gemini session

${chalk.dim("Agent Pool:  ~/.quark/pool/   (auto-seeded with 10 agents on first run)")}
${chalk.dim("Config:      ~/.config/quark-mmc/config.json")}
`);

program.parse(process.argv);
