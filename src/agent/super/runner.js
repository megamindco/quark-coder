// src/agent/super/runner.js
// Super Quark Agent — DASA orchestration: Generator → Manifest → Execute → Watchdog → Pool

import chalk from "chalk";
import ora from "ora";
import { generate } from "./generator.js";
import { executeAgent } from "./executor.js";
import { watchdogPhase1, watchdogPhase2, buildRespawnContext } from "./watchdog.js";
import { initPool, updateAgentScore, saveLearning, getPoolPath } from "./pool.js";

const BRAND  = "#00CFFF";
const GREEN  = "#39D353";
const YELLOW = "#F0C040";
const RED    = "#FF6B6B";
const DIM    = "#555555";

const MAX_RESPAWNS = 2;

// ── Display helpers ────────────────────────────────────────────────────────

function header(text) {
  console.log("\n" + chalk.hex(BRAND).bold(text));
}

function subheader(text) {
  console.log(chalk.dim("  " + text));
}

function agentLine(emoji, role, text) {
  console.log(`  ${emoji} ${chalk.hex(BRAND)(role)} ${chalk.dim("—")} ${chalk.white(text)}`);
}

function toolLine(name, detail) {
  const icons = {
    execute_bash: "⚙ ", mcp_create_file: "✎ ", mcp_bulk_file_writer: "✎ ",
    mcp_view_file: "📄", mcp_search_replace: "✎ ", grep_tool: "🔍",
    mcp_glob_files: "🔍", ask_human: "? ", think: "◈ ", finish: "✦ ",
  };
  const icon = icons[name] || "·";
  const shortDetail = String(detail || "").slice(0, 70);
  console.log(chalk.dim(`    ${icon} ${name}: ${shortDetail}`));
}

function watchdogLine(phase, status, score, failedChecks) {
  const dot = status === "PASS" ? chalk.hex(GREEN)("✦") :
              status === "CONDITIONAL" ? chalk.hex(YELLOW)("⚠") :
              chalk.hex(RED)("✗");
  const scoreStr = chalk.dim(`(${(score * 100).toFixed(0)}%)`);
  const failed = failedChecks.length ? chalk.dim(` failed: ${failedChecks.join(", ")}`) : "";
  console.log(`  ${dot} Watchdog Phase ${phase}: ${chalk.white(status)} ${scoreStr}${failed}`);
}

function divider() {
  console.log(chalk.dim("  " + "─".repeat(56)));
}

// ── Main Super Runner ──────────────────────────────────────────────────────

export async function runSuperAgent({
  task,
  provider,
  apiKey,
  model,
  cwd = process.cwd(),
  providerConfig = {},
}) {
  // Init pool on startup
  initPool();

  // ── Banner ──────────────────────────────────────────────────────────────
  console.log("\n" + chalk.hex(BRAND).bold("  ⬡ Super Quark Agent") + chalk.dim(" — DASA Orchestration\n"));
  console.log(chalk.dim("  Provider: ") + chalk.white(`${provider} / ${model}`));
  console.log(chalk.dim("  Task:     ") + chalk.white(task));
  console.log(chalk.dim("  Dir:      ") + chalk.white(cwd));
  console.log(chalk.dim("  Pool:     ") + chalk.white(getPoolPath()));
  console.log();

  // ── Phase 0: Generate Spawn Manifest ────────────────────────────────────
  header("Phase 0 — Generator");

  const genSpinner = ora({ text: "Analyzing task and composing agent team...", color: "cyan" }).start();
  let manifest;
  try {
    manifest = await generate({ task, provider, apiKey, model, providerConfig });
    genSpinner.stop();
  } catch (err) {
    genSpinner.stop();
    console.error(chalk.hex(RED)(`  ✗ Generator failed: ${err.message}`));
    throw err;
  }

  console.log(chalk.hex(GREEN)(`  ✦ Spawn Manifest: ${manifest.manifest_id}`));
  console.log(chalk.dim(`  Task:       `) + chalk.white(manifest.task_summary || task));
  console.log(chalk.dim(`  Complexity: `) + chalk.white(manifest.complexity || "—"));
  console.log(chalk.dim(`  Team:       `) + chalk.white(manifest.agents.map(a => a.role).join(" → ")));
  console.log(chalk.dim(`  Rationale:  `) + chalk.dim(manifest.rationale || ""));
  divider();

  // ── Phase 1–N: Execute agents per execution_order ────────────────────────
  header("Phase 1 — Agent Execution");

  const agentOutputs = {};     // agent_id → final output string
  const agentScores  = {};     // agent_id → phase1 score
  let sessionLearnings = [];

  for (const phase of manifest.execution_order) {
    console.log(chalk.dim(`\n  Phase ${phase.phase} ${phase.parallel ? "(parallel)" : "(sequential)"}: `) +
      chalk.white(phase.agents.join(", ")));

    const phaseAgents = manifest.agents.filter(a => phase.agents.includes(a.agent_id));

    // For parallel phases, run concurrently
    const runAgent = async (agentDef) => {
      let respawns = 0;
      let phase1Result;
      let output;

      while (respawns <= MAX_RESPAWNS) {
        const isRespawn = respawns > 0;
        agentLine(isRespawn ? "↺" : "⬡", agentDef.role, isRespawn ? `Respawn ${respawns}/${MAX_RESPAWNS}` : "Starting...");

        const spinner = ora({
          text: `  ${agentDef.role} working...`,
          indent: 4,
          color: "cyan",
          spinner: "dots",
        }).start();

        let result;
        try {
          const taskForAgent = isRespawn
            ? buildRespawnContext(agentDef, task, phase1Result.failedChecks, output || "")
            : undefined;

          result = await executeAgent({
            agentDef: taskForAgent ? { ...agentDef, task_slice: taskForAgent } : agentDef,
            manifest,
            priorOutputs: agentOutputs,
            provider, apiKey, model, cwd, providerConfig,
            onTurn: (turn, text) => {
              if (text?.trim()) spinner.text = `  ${agentDef.role} — turn ${turn}`;
            },
            onToolCall: (name, input) => {
              spinner.stop();
              const detail = input.command || input.path || input.pattern || "";
              toolLine(name, detail);
              spinner.start();
            },
            onToolResult: (name, res) => {
              // Surface errors
              if (res?.error) {
                spinner.stop();
                console.log(chalk.hex(RED)(`      ✗ ${res.error.slice(0, 100)}`));
                spinner.start();
              }
            },
          });
        } catch (err) {
          spinner.stop();
          console.log(chalk.hex(RED)(`    ✗ ${agentDef.role} error: ${err.message.slice(0, 150)}`));
          break;
        }

        spinner.stop();
        output = result.output;

        // Watchdog Phase 1
        phase1Result = watchdogPhase1(agentDef, output);
        watchdogLine(1, phase1Result.status, phase1Result.score, phase1Result.failedChecks);

        agentScores[agentDef.agent_id] = phase1Result.score;

        if (phase1Result.status !== "FAIL" || respawns >= MAX_RESPAWNS) {
          if (phase1Result.status === "FAIL") {
            console.log(chalk.hex(YELLOW)(`    ⚠ Max respawns reached for ${agentDef.role}. Proceeding.`));
          }
          break;
        }

        respawns++;
        console.log(chalk.hex(YELLOW)(`    ↺ Respawning ${agentDef.role}...`));
      }

      agentOutputs[agentDef.agent_id] = output || "";
      console.log(chalk.dim(`    ✓ ${agentDef.role} complete. Output: ${(output || "").length} chars`));
    };

    if (phase.parallel && phaseAgents.length > 1) {
      await Promise.all(phaseAgents.map(runAgent));
    } else {
      for (const agentDef of phaseAgents) {
        await runAgent(agentDef);
      }
    }
  }

  divider();

  // ── Watchdog Phase 2: Compound coherence ────────────────────────────────
  header("Phase 2 — Watchdog Compound Validation");

  const phase2Result = watchdogPhase2(manifest, agentOutputs);
  watchdogLine(2, phase2Result.approved ? "PASS" : "FAIL", phase2Result.score, phase2Result.failedChecks);

  if (!phase2Result.approved) {
    console.log(chalk.hex(YELLOW)("\n  ⚠ Compound coherence below threshold. Proceeding with warning."));
    console.log(chalk.dim(`  Failed: ${phase2Result.failedChecks.join(", ")}`));
  }

  divider();

  // ── Agent Pool Write-back ────────────────────────────────────────────────
  header("Phase 3 — Agent Pool Write-back");

  for (const agentDef of manifest.agents) {
    const score = agentScores[agentDef.agent_id] ?? 0.5;
    const updated = updateAgentScore(agentDef.role_slug, score);
    if (updated) {
      const avg = updated.performance.avg_watchdog_score?.toFixed(2) || "—";
      console.log(chalk.dim(`  ✓ ${agentDef.role}: session score ${score.toFixed(2)}, avg now ${avg}`));
    } else {
      console.log(chalk.dim(`  ○ ${agentDef.role}: not in pool (custom agent, skipping)`));
    }
  }

  // Save session learning
  const sessionId = manifest.manifest_id.slice(-8);
  const learningContent = [
    `# Session: ${manifest.manifest_id}`,
    `Date: ${new Date().toISOString()}`,
    `Task: ${task}`,
    `Team: ${manifest.agents.map(a => a.role).join(" → ")}`,
    `Phase 2 Score: ${phase2Result.score}`,
    `Phase 2 Approved: ${phase2Result.approved}`,
    "",
    "## Agent Scores",
    ...manifest.agents.map(a => `- ${a.role}: ${(agentScores[a.agent_id] || 0).toFixed(2)}`),
    "",
    "## Phase 2 Issues",
    phase2Result.failedChecks.length ? phase2Result.failedChecks.join(", ") : "None",
  ].join("\n");
  saveLearning(sessionId, learningContent);

  divider();

  // ── Final Summary ────────────────────────────────────────────────────────
  header("⬡ Super Quark Agent — Complete");
  console.log();
  console.log(chalk.dim("  Manifest:    ") + chalk.white(manifest.manifest_id));
  console.log(chalk.dim("  Agents run:  ") + chalk.white(manifest.agents.length));
  console.log(chalk.dim("  Phase 2:     ") + chalk.white(phase2Result.approved ? chalk.hex(GREEN)("APPROVED") : chalk.hex(YELLOW)("CONDITIONAL")));
  console.log(chalk.dim("  Total output:") + chalk.white(Object.values(agentOutputs).reduce((s, o) => s + o.length, 0) + " chars"));
  console.log();
  console.log(chalk.hex(BRAND)("  Agent summaries:"));
  for (const [id, output] of Object.entries(agentOutputs)) {
    const agentDef = manifest.agents.find(a => a.agent_id === id);
    const preview = output.replace(/\n/g, " ").slice(0, 80);
    console.log(`  ${chalk.dim("·")} ${chalk.white(agentDef?.role || id)}: ${chalk.dim(preview)}...`);
  }
  console.log();

  return { manifest, agentOutputs, phase2Result };
}
