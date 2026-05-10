// src/agent/super/generator.js
// Generator — decomposes task into a Spawn Manifest using LLM

import { callProviderOnce } from "../providers.js";
import { listAgents, queryByCapability } from "./pool.js";

const GENERATOR_SYSTEM = `You are the Generator — the meta-agent in the DASA (Dynamic Adaptive Self-Aware Agents) architecture.

Your sole job: analyze a task and produce a Spawn Manifest JSON that defines the agent team, their order, and their context bundles.

## Available Agents (from Agent Pool)
{{AGENT_LIST}}

## Rules
1. Use only agents from the pool unless a new role is absolutely necessary
2. Each agent gets a focused slice of work — never assign the full task to one agent
3. Dependencies must form a DAG (no cycles)
4. Keep teams lean: 2-5 agents for most tasks, up to 8 for complex ones
5. The first agent is usually planner or schema-designer
6. The last agent is usually reviewer or docs-writer (unless the task is simple)

## Output Format
Respond with ONLY valid JSON — no markdown fences, no explanation, just the JSON object:

{
  "task_summary": "one-sentence summary of what will be built",
  "complexity": "simple|medium|complex",
  "agents": [
    {
      "agent_id": "unique_short_id",
      "role_slug": "slug-from-pool",
      "role": "Role Name",
      "task_slice": "specific thing this agent does",
      "dependencies": [],
      "context_hints": ["files to look at", "constraints", "prior agent outputs to use"],
      "required_outputs": ["description of expected artifacts"]
    }
  ],
  "execution_order": [
    { "phase": 1, "parallel": false, "agents": ["agent_id"] },
    { "phase": 2, "parallel": true, "agents": ["agent_id_2", "agent_id_3"] }
  ],
  "rationale": "one sentence explaining why this team composition"
}`;

function buildAgentList(agents) {
  return agents.map(a =>
    `- ${a.role_slug} (${a.role}): ${a.description}\n  capabilities: ${(a.capability_keys || []).join(", ")}`
  ).join("\n");
}

export async function generate({ task, provider, apiKey, model, providerConfig = {} }) {
  const agents = listAgents();
  const agentList = buildAgentList(agents);
  const systemPrompt = GENERATOR_SYSTEM.replace("{{AGENT_LIST}}", agentList);

  const userMessage = `Task: ${task}\n\nProduce the Spawn Manifest JSON for this task.`;

  const response = await callProviderOnce({
    provider, apiKey, model,
    systemPrompt,
    userMessage,
    tools: [], // Generator uses text output only
    providerConfig,
  });

  // Parse the JSON manifest from response
  let manifest;
  const rawText = response.text || "";

  // Strip markdown fences if model adds them anyway
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  try {
    manifest = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from text
    const jsonMatch = cleaned.match(/\{[\s\S]+\}/);
    if (jsonMatch) {
      try {
        manifest = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error(`Generator produced invalid JSON. Raw output:\n${rawText.slice(0, 500)}`);
      }
    } else {
      throw new Error(`Generator produced no JSON. Raw output:\n${rawText.slice(0, 500)}`);
    }
  }

  // Validate required fields
  if (!manifest.agents || !Array.isArray(manifest.agents)) {
    throw new Error("Manifest missing agents array");
  }
  if (!manifest.execution_order || !Array.isArray(manifest.execution_order)) {
    // Auto-compute sequential order if missing
    manifest.execution_order = manifest.agents.map((a, i) => ({
      phase: i + 1,
      parallel: false,
      agents: [a.agent_id],
    }));
  }

  // Enrich each agent with pool data (system_prompt_delta, preferred_tools)
  const poolIndex = Object.fromEntries(listAgents().map(a => [a.role_slug, a]));
  manifest.agents = manifest.agents.map(a => {
    const poolAgent = poolIndex[a.role_slug];
    return {
      ...a,
      system_prompt_delta: poolAgent?.system_prompt_delta || "",
      preferred_tools: poolAgent?.preferred_tools || ["execute_bash", "mcp_create_file", "mcp_view_file"],
      watchdog_defaults: poolAgent?.watchdog_defaults || { min_output_length: 100, required_signals: [] },
    };
  });

  // Attach metadata
  manifest.manifest_id = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  manifest.created_at = new Date().toISOString();
  manifest.task = task;
  manifest.locked = true;

  return manifest;
}
