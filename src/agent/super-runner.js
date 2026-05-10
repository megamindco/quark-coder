// src/agent/super-runner.js
// Super Quark Agent — DASA orchestrator
// Generator → Spawn Manifest → Agent Pool → Multi-agent execution → Watchdog

import chalk from "chalk";
import ora from "ora";
import { callProvider, PROVIDERS } from "./providers.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import {
  initPool, queryAgents, getAgent, getAllAgents,
  upsertAgent, updatePerformance, saveLearning,
  saveManifest, loadManifest, updateManifest,
} from "./pool.js";
import {
  runWatchdogPhase1, runWatchdogPhase2,
  printPhase1Result, printPhase2Result,
} from "./watchdog.js";

const BRAND = "#00CFFF";
const MAX_AGENT_TURNS = 25;
const MAX_RESPAWNS = 2;

// ── UI helpers ─────────────────────────────────────────────────────────────

function section(title) {
  console.log("\n" + chalk.hex(BRAND)("  ┌─ ") + chalk.white(title));
}

function step(text) {
  console.log(chalk.dim("  │  ") + chalk.dim(text));
}

function done(text) {
  console.log(chalk.hex(BRAND)("  └─ ") + chalk.white(text));
}

function agentLine(role, text) {
  console.log(chalk.dim(`  [${role}] `) + chalk.white(text));
}

// ── Generator — produces Spawn Manifest via LLM ────────────────────────────

async function runGenerator({ task, poolDir, provider, apiKey, model }) {
  section("Generator");

  const allAgents = getAllAgents(poolDir);
  const agentList = allAgents.map(a =>
    `- ${a.role} (slug: ${a.role_slug}) | capabilities: ${a.capability_keys?.join(", ")}`
  ).join("\n");

  const generatorPrompt = `You are the DASA Generator. Your job is to analyze a task and produce a Spawn Manifest — a structured plan defining which agents to summon, in what order, with what context.

AVAILABLE AGENTS IN POOL:
${agentList}

TASK:
${task}

Analyze the task and produce a Spawn Manifest. You MUST respond with ONLY valid JSON, no markdown fences, no explanation before or after.

The JSON must follow this exact schema:
{
  "task_summary": "concise restatement of the task",
  "agents": [
    {
      "agent_id": "unique_short_id",
      "role_slug": "must match one of the slugs above",
      "role": "human-readable role name",
      "description": "what this agent does specifically for THIS task",
      "dependencies": [],
      "context": {
        "task_slice": "the specific sub-task assigned to this agent",
        "constraints": ["specific constraint 1", "specific constraint 2"],
        "relevant_context": "what prior agents' outputs this agent needs"
      },
      "watchdog_thresholds": {
        "min_output_length": 200,
        "required_artifacts": ["list of expected output types"],
        "quality_signals": ["what good output looks like"]
      }
    }
  ],
  "execution_phases": [
    {
      "phase": 1,
      "parallel": false,
      "agent_ids": ["agent_id_1"]
    }
  ],
  "estimated_complexity": "low|medium|high"
}

Rules:
- Only use agent role_slugs that exist in the pool
- Dependencies must reference agent_ids defined in this same manifest
- Execution phases must respect dependencies (an agent cannot run in phase N if its dependency runs in phase N)
- For simple tasks, 1-2 agents is fine. Don't over-engineer.
- For complex full-stack tasks, use 3-5 agents max.`;

  const spinner = ora({ text: "Generator analyzing task...", color: "cyan" }).start();

  let manifest = null;
  let attempts = 0;

  while (!manifest && attempts < 3) {
    attempts++;
    try {
      const resp = await callProvider({
        provider, apiKey, model,
        systemPrompt: "You are a task decomposition expert. Output only valid JSON.",
        messages: [{ role: "user", content: generatorPrompt }],
        tools: [],
      });

      const cleaned = resp.text.replace(/```json|```/g, "").trim();
      // Extract JSON if surrounded by other text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      manifest = JSON.parse(jsonMatch[0]);
    } catch (err) {
      step(`Attempt ${attempts} failed: ${err.message}. Retrying...`);
      if (attempts >= 3) {
        spinner.stop();
        throw new Error(`Generator failed after ${attempts} attempts: ${err.message}`);
      }
    }
  }

  spinner.stop();

  // Build full manifest with ID
  const manifestId = `sm_${Date.now()}`;
  const fullManifest = {
    manifest_id: manifestId,
    task,
    task_summary: manifest.task_summary || task,
    created_at: new Date().toISOString(),
    estimated_complexity: manifest.estimated_complexity || "medium",
    agents: manifest.agents || [],
    execution_phases: manifest.execution_phases || [{ phase: 1, parallel: false, agent_ids: manifest.agents?.map(a => a.agent_id) || [] }],
    watchdog_results: {},
    agent_outputs: {},
  };

  saveManifest(fullManifest, poolDir);

  step(`Manifest: ${manifestId}`);
  step(`Agents: ${fullManifest.agents.map(a => a.role).join(" → ")}`);
  step(`Phases: ${fullManifest.execution_phases.length} | Complexity: ${fullManifest.estimated_complexity}`);
  done("Spawn Manifest created");

  return fullManifest;
}

// ── Single agent execution ─────────────────────────────────────────────────

async function runSingleAgent({
  agentSpec,
  manifest,
  priorOutputs,
  provider,
  apiKey,
  model,
  poolDir,
  cwd,
}) {
  const poolAgent = getAgent(agentSpec.role_slug, poolDir);
  const delta = poolAgent?.system_prompt_delta || "";

  // Build agent-specific system prompt
  const agentSystemPrompt = `${SYSTEM_PROMPT}

## Your Role This Session
You are: ${agentSpec.role}
Your specific task: ${agentSpec.description}

## Your Sub-Task
${agentSpec.context?.task_slice || manifest.task}

## Constraints
${(agentSpec.context?.constraints || []).map(c => `- ${c}`).join("\n") || "- Follow standard best practices"}

${priorOutputs.length > 0 ? `## Prior Agent Outputs (for context)
${priorOutputs.map(p => `### ${p.role}\n${p.output.slice(0, 600)}`).join("\n\n")}` : ""}

## Role-Specific Instructions
${delta}

Focus ONLY on your assigned task. Call \`finish\` when your work is complete.`;

  const task_msg = agentSpec.context?.task_slice || manifest.task;
  const messages = [{ role: "user", content: `Execute your task: ${task_msg}` }];

  let output = "";
  let turns = 0;
  let done_ = false;

  while (!done_ && turns < MAX_AGENT_TURNS) {
    turns++;

    const resp = await callProvider({
      provider, apiKey, model,
      systemPrompt: agentSystemPrompt,
      messages,
      tools: TOOL_DEFINITIONS,
    });

    if (resp.text?.trim()) output += resp.text + "\n";

    messages.push({ role: "assistant", content: resp.rawContent });

    const toolResults = [];
    for (const tc of resp.toolCalls) {
      if (tc.name === "think") {
        console.log(chalk.dim(`  [${agentSpec.role}] ◈ ${tc.input.thought?.slice(0, 80)}`));
      } else if (tc.name === "finish") {
        output += `\nSUMMARY: ${tc.input.summary}`;
        done_ = true;
        agentLine(agentSpec.role, tc.input.summary);
      } else {
        agentLine(agentSpec.role, `${tc.name}: ${JSON.stringify(tc.input).slice(0, 60)}`);
      }

      const result = await executeTool(tc.name, tc.input, cwd);

      // Collect file creation outputs for watchdog
      if (["mcp_create_file", "mcp_bulk_file_writer", "mcp_search_replace"].includes(tc.name)) {
        output += `\n[ARTIFACT] ${JSON.stringify(tc.input).slice(0, 100)}`;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: JSON.stringify(result),
      });
    }

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }

    if (resp.stopReason === "end_turn" && resp.toolCalls.length === 0) done_ = true;
  }

  return output.trim();
}

// ── Main DASA orchestrator ─────────────────────────────────────────────────

export async function runSuperAgent({
  task,
  provider = "anthropic",
  apiKey,
  model,
  cwd = process.cwd(),
  providerConfig = {},
}) {
  const providerDef = PROVIDERS[provider];
  const resolvedModel = model || providerDef?.defaultModel || "claude-opus-4-5";

  console.log(chalk.hex(BRAND)("\n  ⬡⬡ Super Quark Agent — DASA Pipeline\n"));
  console.log(chalk.dim("  Provider:  ") + chalk.white(providerDef?.label || provider));
  console.log(chalk.dim("  Model:     ") + chalk.white(resolvedModel));
  console.log(chalk.dim("  Task:      ") + chalk.white(task));
  console.log(chalk.dim("  Dir:       ") + chalk.white(cwd));
  console.log();

  // ── Init Agent Pool ──────────────────────────────────────────────────────
  const poolDir = initPool(cwd);
  step(`Agent Pool: ${poolDir}`);

  // ── Phase 1: Generator ───────────────────────────────────────────────────
  let manifest;
  try {
    manifest = await runGenerator({ task, poolDir, provider, apiKey, model: resolvedModel });
  } catch (err) {
    console.error(chalk.red(`\n  ✗ Generator failed: ${err.message}`));
    return;
  }

  // ── Phase 2-N: Execute agents by phase ───────────────────────────────────
  const agentOutputs = {};  // agentId → { role, output }
  const phase1Results = {}; // agentId → watchdog P1 result
  const sessionId = manifest.manifest_id;

  for (const phase of manifest.execution_phases) {
    section(`Phase ${phase.phase} — ${phase.parallel ? "parallel" : "sequential"}`);

    const agentIds = phase.agent_ids || [];
    const agentsInPhase = agentIds
      .map(id => manifest.agents.find(a => a.agent_id === id))
      .filter(Boolean);

    // Build prior outputs (from completed agents)
    const priorOutputs = Object.entries(agentOutputs).map(([, v]) => v);

    if (phase.parallel && agentsInPhase.length > 1) {
      // Run in parallel
      step(`Running ${agentsInPhase.length} agents in parallel...`);
      const results = await Promise.all(
        agentsInPhase.map(agentSpec =>
          runSingleAgent({ agentSpec, manifest, priorOutputs, provider, apiKey, model: resolvedModel, poolDir, cwd })
            .then(output => ({ agentSpec, output }))
            .catch(err => ({ agentSpec, output: `ERROR: ${err.message}` }))
        )
      );
      for (const { agentSpec, output } of results) {
        agentOutputs[agentSpec.agent_id] = { role: agentSpec.role, output };
      }
    } else {
      // Run sequentially
      for (const agentSpec of agentsInPhase) {
        step(`Running ${agentSpec.role}...`);
        let output = "";
        let respawns = 0;
        let p1;

        do {
          output = await runSingleAgent({
            agentSpec, manifest,
            priorOutputs: Object.values(agentOutputs),
            provider, apiKey, model: resolvedModel, poolDir, cwd,
          }).catch(err => `ERROR: ${err.message}`);

          p1 = runWatchdogPhase1(agentSpec.agent_id, output, agentSpec);
          printPhase1Result(p1);

          if (p1.status === "FAIL" && respawns < MAX_RESPAWNS) {
            respawns++;
            console.log(chalk.yellow(`  ↺ Respawning ${agentSpec.role} (${respawns}/${MAX_RESPAWNS})...`));
            console.log(chalk.dim(`    Reason: ${p1.failedChecks.join(", ")}`));
            // Inject failure context into agent spec for next attempt
            agentSpec = {
              ...agentSpec,
              context: {
                ...agentSpec.context,
                constraints: [
                  ...(agentSpec.context?.constraints || []),
                  `RESPAWN ${respawns}: Previous attempt failed checks: ${p1.failedChecks.join(", ")}. Previous output had issues, produce a complete, thorough response.`,
                ],
              },
            };
          }
        } while (p1.status === "FAIL" && respawns < MAX_RESPAWNS);

        phase1Results[agentSpec.agent_id] = p1;
        agentOutputs[agentSpec.agent_id] = { role: agentSpec.role, output };
      }
    }

    // Run P1 for parallel agents after the fact
    for (const agentSpec of agentsInPhase) {
      if (!phase1Results[agentSpec.agent_id]) {
        const output = agentOutputs[agentSpec.agent_id]?.output || "";
        const p1 = runWatchdogPhase1(agentSpec.agent_id, output, agentSpec);
        printPhase1Result(p1);
        phase1Results[agentSpec.agent_id] = p1;
      }
    }

    done(`Phase ${phase.phase} complete`);
  }

  // ── Watchdog Phase 2 ─────────────────────────────────────────────────────
  section("Watchdog Phase 2 — Compound Coherence");

  const p2 = await runWatchdogPhase2({
    task,
    agentOutputs,
    phase1Results,
    provider,
    apiKey,
    model: resolvedModel,
  });

  printPhase2Result(p2);

  // ── Agent Pool write-back ────────────────────────────────────────────────
  section("Agent Pool Write-back");

  for (const [agentId, p1] of Object.entries(phase1Results)) {
    const agentSpec = manifest.agents.find(a => a.agent_id === agentId);
    if (!agentSpec) continue;

    const sessionScore = parseFloat(((p1.score + p2.score) / 2).toFixed(2));
    const updated = updatePerformance(agentSpec.role_slug, sessionScore, null, poolDir);
    step(`${agentSpec.role}: score ${sessionScore}${updated ? "" : " (agent not in pool)"}`);
  }

  if (p2.summary) {
    saveLearning(sessionId, `Task: ${task}\n\nWatchdog P2 summary: ${p2.summary}\n\nIssues: ${(p2.issues || []).join("; ") || "none"}`, poolDir);
    step("Session learning saved");
  }

  // ── Update manifest with results ─────────────────────────────────────────
  updateManifest(manifest.manifest_id, {
    watchdog_results: { phase1: phase1Results, phase2: p2 },
    agent_outputs: Object.fromEntries(Object.entries(agentOutputs).map(([k, v]) => [k, v.output.slice(0, 500)])),
    approved_for_delivery: p2.approved,
    completed_at: new Date().toISOString(),
  }, poolDir);

  // ── Final summary ────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.hex(BRAND)("  ⬡⬡ Super Quark Agent Complete\n"));

  const p1Avg = Object.values(phase1Results).reduce((s, r) => s + (r.score || 0), 0) /
                Math.max(Object.values(phase1Results).length, 1);

  console.log(chalk.dim("  Manifest:   ") + chalk.white(manifest.manifest_id));
  console.log(chalk.dim("  Agents:     ") + chalk.white(manifest.agents.map(a => a.role).join(", ")));
  console.log(chalk.dim("  P1 avg:     ") + chalk.white(p1Avg.toFixed(2)));
  console.log(chalk.dim("  P2 score:   ") + chalk.white(p2.score));
  console.log(chalk.dim("  Delivered:  ") + (p2.approved ? chalk.hex(BRAND)("yes") : chalk.yellow("conditional")));
  console.log();
}
