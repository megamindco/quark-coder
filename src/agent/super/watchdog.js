// src/agent/super/watchdog.js
// Watchdog — two-phase quality gate for Super Quark Agent

// ── Phase 1: per-agent validation ─────────────────────────────────────────

export function watchdogPhase1(agentDef, output) {
  const checks = {};
  const thresholds = agentDef.watchdog_defaults || {};

  // Check 1: Output exists and is non-trivial
  checks.output_exists = typeof output === "string" && output.trim().length > 20;

  // Check 2: Minimum length
  const minLen = thresholds.min_output_length || 50;
  checks.min_length = output.length >= minLen;

  // Check 3: No empty stubs
  checks.no_stubs = !/(TODO|PLACEHOLDER|FIXME|stub|not implemented)/i.test(output);

  // Check 4: Required signals present (role-specific)
  const signals = thresholds.required_signals || [];
  if (signals.length > 0) {
    checks.required_signals = signals.every(sig =>
      output.toLowerCase().includes(sig.toLowerCase())
    );
  } else {
    checks.required_signals = true;
  }

  // Check 5: No truncation indicators
  checks.not_truncated = !/(\.\.\.|continued in next|see above|as shown before)$/i.test(output.trim());

  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const score = parseFloat((passed / total).toFixed(2));

  const status = score >= 0.9 ? "PASS" : score >= 0.7 ? "CONDITIONAL" : "FAIL";
  const failedChecks = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);

  return { score, status, checks, failedChecks, passed, total };
}

// ── Phase 2: compound coherence validation ─────────────────────────────────

export function watchdogPhase2(manifest, agentOutputs) {
  const checks = {};
  const agentIds = Object.keys(agentOutputs);

  // Check 1: All agents have output
  checks.all_agents_complete = manifest.agents.every(a => agentOutputs[a.agent_id]?.trim()?.length > 0);

  // Check 2: No agent contradicts the task
  const taskWords = manifest.task.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  checks.task_coverage = agentIds.some(id => {
    const out = agentOutputs[id]?.toLowerCase() || "";
    return taskWords.filter(w => out.includes(w)).length >= Math.min(3, taskWords.length);
  });

  // Check 3: Sequential agents reference prior agent outputs
  // (check that phase 2+ agents mention things from phase 1)
  if (manifest.execution_order.length > 1) {
    const phase1Agents = manifest.execution_order[0]?.agents || [];
    const laterAgents = manifest.execution_order.slice(1).flatMap(p => p.agents);
    if (phase1Agents.length && laterAgents.length) {
      const phase1Output = phase1Agents.map(id => agentOutputs[id] || "").join(" ").toLowerCase();
      // Extract key nouns from phase 1 output (rough heuristic)
      const phase1Keywords = [...new Set(
        (phase1Output.match(/\b[a-z]{5,}\b/g) || [])
          .filter(w => !["should", "would", "could", "these", "those", "their", "where", "which", "about", "using", "based", "first", "second", "third"].includes(w))
          .slice(0, 15)
      )];
      const laterOutput = laterAgents.map(id => agentOutputs[id] || "").join(" ").toLowerCase();
      const overlap = phase1Keywords.filter(kw => laterOutput.includes(kw)).length;
      checks.cross_agent_coherence = overlap >= Math.min(3, phase1Keywords.length / 2);
    } else {
      checks.cross_agent_coherence = true;
    }
  } else {
    checks.cross_agent_coherence = true;
  }

  // Check 4: No duplicate work (agents doing the same thing)
  // Heuristic: check for very high similarity between agent outputs
  checks.no_duplicate_work = true;
  const outputList = agentIds.map(id => (agentOutputs[id] || "").slice(0, 200));
  for (let i = 0; i < outputList.length; i++) {
    for (let j = i + 1; j < outputList.length; j++) {
      if (outputList[i].length > 50 && outputList[j].length > 50) {
        const similarity = computeSimilarity(outputList[i], outputList[j]);
        if (similarity > 0.85) {
          checks.no_duplicate_work = false;
          break;
        }
      }
    }
    if (!checks.no_duplicate_work) break;
  }

  // Check 5: Compound output is non-trivial
  const totalOutputLen = Object.values(agentOutputs).reduce((s, o) => s + (o?.length || 0), 0);
  checks.compound_substantial = totalOutputLen > 300;

  const weights = {
    all_agents_complete: 0.30,
    task_coverage: 0.25,
    cross_agent_coherence: 0.20,
    no_duplicate_work: 0.15,
    compound_substantial: 0.10,
  };

  let weightedScore = 0;
  for (const [check, val] of Object.entries(checks)) {
    weightedScore += (val ? 1 : 0) * (weights[check] || 0.1);
  }

  const score = parseFloat(weightedScore.toFixed(2));
  const approved = score >= 0.75;
  const failedChecks = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);

  return { score, approved, checks, failedChecks };
}

// Simple bigram similarity
function computeSimilarity(a, b) {
  const bigrams = (s) => {
    const result = new Set();
    for (let i = 0; i < s.length - 1; i++) result.add(s.slice(i, i + 2));
    return result;
  };
  const bg1 = bigrams(a.toLowerCase());
  const bg2 = bigrams(b.toLowerCase());
  const intersection = [...bg1].filter(bg => bg2.has(bg)).length;
  return intersection / Math.max(bg1.size, bg2.size, 1);
}

// ── Respawn context builder ────────────────────────────────────────────────

export function buildRespawnContext(agentDef, originalTask, failedChecks, previousOutput) {
  return `RESPAWN CONTEXT — You are being re-run because your previous output failed quality checks.

Failed checks: ${failedChecks.join(", ")}

Previous output (failed):
---
${previousOutput.slice(0, 800)}
---

Your task (repeat): ${originalTask}
${agentDef.task_slice ? `Your specific slice: ${agentDef.task_slice}` : ""}

Fix the issues above. Be complete and avoid the failed checks.`;
}
