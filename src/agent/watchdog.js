// src/agent/watchdog.js
// Two-phase Watchdog validation for Super Quark Agent

import chalk from "chalk";
import ora from "ora";
import { callProvider } from "./providers.js";

const BRAND = "#00CFFF";

// ── Phase 1: Per-agent validation ──────────────────────────────────────────

/**
 * Validate a single agent's output against its manifest thresholds.
 * Returns { score, status, checks, failedChecks }
 */
export function runWatchdogPhase1(agentId, output, agentSpec) {
  const thresholds = agentSpec.watchdog_thresholds || agentSpec.watchdog_defaults || {};
  const minLen = thresholds.min_output_length || 100;
  const requiredArtifacts = thresholds.required_artifacts || [];
  const qualitySignals = thresholds.quality_signals || [];

  const checks = {};

  // Check 1: output exists
  checks.output_exists = typeof output === "string" && output.trim().length > 0;

  // Check 2: minimum length
  checks.min_length = (output || "").length >= minLen;

  // Check 3: not just a stub / TODO
  const stubPatterns = /^(todo|placeholder|coming soon|not implemented|stub)$/im;
  checks.not_stub = !stubPatterns.test((output || "").trim().slice(0, 100));

  // Check 4: required artifacts mentioned
  if (requiredArtifacts.length > 0) {
    checks.required_artifacts = requiredArtifacts.every(artifact =>
      (output || "").toLowerCase().includes(artifact.toLowerCase())
    );
  } else {
    checks.required_artifacts = true;
  }

  // Check 5: quality signals present
  if (qualitySignals.length > 0) {
    const signalsPassed = qualitySignals.filter(sig =>
      (output || "").toLowerCase().includes(sig.toLowerCase())
    );
    checks.quality_signals = signalsPassed.length >= Math.ceil(qualitySignals.length * 0.5);
  } else {
    checks.quality_signals = true;
  }

  // Check 6: no runaway repetition (basic sanity)
  const lines = (output || "").split("\n");
  const uniqueLines = new Set(lines.map(l => l.trim()).filter(Boolean));
  checks.no_repetition = lines.length <= 10 || uniqueLines.size / lines.length > 0.3;

  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const score = parseFloat((passed / total).toFixed(2));

  const status =
    score >= 0.85 ? "PASS" :
    score >= 0.65 ? "CONDITIONAL" :
    "FAIL";

  const failedChecks = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return { score, status, checks, failedChecks, agentId };
}

/**
 * Display Phase 1 result
 */
export function printPhase1Result(result) {
  const emoji = result.status === "PASS" ? chalk.hex(BRAND)("✦") :
                result.status === "CONDITIONAL" ? chalk.yellow("⚠") :
                chalk.red("✗");

  console.log(`\n  ${emoji} Watchdog P1 [${result.agentId}]: ${result.status} (${result.score})`);
  if (result.failedChecks.length > 0) {
    console.log(chalk.dim(`     Failed: ${result.failedChecks.join(", ")}`));
  }
}

// ── Phase 2: Compound coherence ────────────────────────────────────────────

/**
 * Run Phase 2 using LLM to evaluate compound coherence.
 * Returns { score, approved, issues, summary }
 */
export async function runWatchdogPhase2({
  task,
  agentOutputs,  // { agentId: { role, output } }
  phase1Results, // { agentId: { score, status } }
  provider,
  apiKey,
  model,
}) {
  const spinner = ora({ text: "Watchdog Phase 2 — compound coherence...", color: "cyan" }).start();

  // Build compound summary for evaluation
  const agentSummaries = Object.entries(agentOutputs)
    .map(([id, { role, output }]) => {
      const p1 = phase1Results[id];
      return `### Agent: ${id} (${role}) — P1: ${p1?.status || "?"} (${p1?.score || "?"})\n${(output || "").slice(0, 800)}`;
    })
    .join("\n\n---\n\n");

  const evalPrompt = `You are the DASA Watchdog Phase 2 evaluator. Evaluate compound coherence of multi-agent outputs.

ORIGINAL TASK: ${task}

AGENT OUTPUTS:
${agentSummaries}

Evaluate:
1. interface_coherence: Do agent outputs fit together without conflicts?
2. no_contradiction: Do any agents contradict each other's assumptions?
3. integration_ready: Can outputs be assembled without conflicts?
4. shared_state_consistency: Are shared data structures (schemas, types) consistent?
5. task_coverage: Does the compound output address the original task?

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "scores": {
    "interface_coherence": 0.0-1.0,
    "no_contradiction": 0.0-1.0,
    "integration_ready": 0.0-1.0,
    "shared_state_consistency": 0.0-1.0,
    "task_coverage": 0.0-1.0
  },
  "issues": ["list of specific coherence problems found, empty if none"],
  "summary": "one sentence overall assessment"
}`;

  try {
    const resp = await callProvider({
      provider,
      apiKey,
      model,
      systemPrompt: "You are a code review and quality assessment expert. Output only valid JSON.",
      messages: [{ role: "user", content: evalPrompt }],
      tools: [],
    });

    spinner.stop();

    let parsed;
    try {
      const cleaned = resp.text.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Fall back to heuristic scoring
      return heuristicPhase2(phase1Results);
    }

    const weights = {
      interface_coherence: 0.30,
      no_contradiction: 0.25,
      integration_ready: 0.20,
      shared_state_consistency: 0.15,
      task_coverage: 0.10,
    };

    const score = parseFloat(
      Object.entries(weights)
        .reduce((sum, [k, w]) => sum + (parsed.scores?.[k] || 0) * w, 0)
        .toFixed(2)
    );

    const approved = score >= 0.80;

    return {
      score,
      approved,
      issues: parsed.issues || [],
      summary: parsed.summary || "",
      scores: parsed.scores || {},
    };
  } catch (err) {
    spinner.stop();
    console.log(chalk.dim(`  ⚠ Phase 2 LLM eval failed: ${err.message}. Using heuristic.`));
    return heuristicPhase2(phase1Results);
  }
}

/**
 * Heuristic Phase 2 fallback (no LLM needed)
 */
function heuristicPhase2(phase1Results) {
  const scores = Object.values(phase1Results).map(r => r.score || 0);
  const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  const allPassed = Object.values(phase1Results).every(r => r.status !== "FAIL");
  const score = parseFloat((avg * (allPassed ? 1 : 0.85)).toFixed(2));

  return {
    score,
    approved: score >= 0.75,
    issues: allPassed ? [] : ["Some agents failed Phase 1 — compound coherence uncertain"],
    summary: `Heuristic score based on Phase 1 averages (${score})`,
    scores: {},
  };
}

/**
 * Display Phase 2 result
 */
export function printPhase2Result(result) {
  const emoji = result.approved ? chalk.hex(BRAND)("✦") : chalk.red("✗");
  console.log(`\n  ${emoji} Watchdog P2: ${result.approved ? "APPROVED" : "REJECTED"} (${result.score})`);
  if (result.summary) console.log(chalk.dim(`     ${result.summary}`));
  if (result.issues?.length > 0) {
    console.log(chalk.yellow("     Issues:"));
    result.issues.forEach(i => console.log(chalk.dim(`     · ${i}`)));
  }
}
