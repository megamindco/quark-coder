// src/agent/super/executor.js
// Executor — runs a single DASA agent as a focused sub-agent with tools

import { callProvider } from "../providers.js";
import { TOOL_DEFINITIONS, executeTool } from "../tools.js";
import { SYSTEM_PROMPT } from "../system-prompt.js";

const MAX_AGENT_TURNS = 20;

// Build a specialized system prompt for a DASA sub-agent
function buildAgentSystem(agentDef, manifest, priorOutputs) {
  const priorContext = Object.entries(priorOutputs)
    .map(([id, out]) => {
      const a = manifest.agents.find(x => x.agent_id === id);
      return a ? `=== ${a.role} (${id}) output ===\n${out.slice(0, 1500)}\n` : "";
    })
    .filter(Boolean)
    .join("\n");

  return `${SYSTEM_PROMPT}

## YOU ARE: ${agentDef.role}
${agentDef.system_prompt_delta ? `\n## Your specific instructions:\n${agentDef.system_prompt_delta}` : ""}

## YOUR TASK FOR THIS SESSION:
${agentDef.task_slice || manifest.task}

## CONTEXT HINTS:
${(agentDef.context_hints || []).map(h => `- ${h}`).join("\n") || "None provided."}

## EXPECTED OUTPUTS:
${(agentDef.required_outputs || []).map(o => `- ${o}`).join("\n") || "Complete your task slice as specified."}

${priorContext ? `## PRIOR AGENT OUTPUTS (use as context):\n${priorContext}` : ""}

## IMPORTANT:
- Focus ONLY on your task slice. Do not redo what prior agents did.
- Use tools to actually write files and run commands — don't just describe what to do.
- Call finish() when your task slice is complete.`;
}

// Run a single agent through its agentic loop
export async function executeAgent({
  agentDef,
  manifest,
  priorOutputs,
  provider,
  apiKey,
  model,
  cwd,
  providerConfig = {},
  onTurn,      // callback(turn, text, toolCalls)
  onToolCall,  // callback(name, input)
  onToolResult,// callback(name, result)
}) {
  const systemPrompt = buildAgentSystem(agentDef, manifest, priorOutputs);
  const firstMessage = agentDef.task_slice || manifest.task;

  const messages = [{ role: "user", content: firstMessage }];
  let turns = 0;
  let done = false;
  let finalOutput = "";
  let finishSummary = "";

  while (!done && turns < MAX_AGENT_TURNS) {
    turns++;

    let response;
    try {
      response = await callProvider({
        provider, apiKey, model,
        systemPrompt,
        messages,
        tools: TOOL_DEFINITIONS,
        providerConfig,
      });
    } catch (err) {
      throw new Error(`Agent ${agentDef.agent_id} LLM error on turn ${turns}: ${err.message}`);
    }

    if (response.text?.trim()) {
      finalOutput += response.text + "\n";
    }

    onTurn?.(turns, response.text, response.toolCalls);

    messages.push({ role: "assistant", content: response.rawContent });

    const toolResults = [];
    for (const tc of response.toolCalls) {
      onToolCall?.(tc.name, tc.input);
      const result = await executeTool(tc.name, tc.input, cwd);
      onToolResult?.(tc.name, result);

      if (tc.name === "finish") {
        done = true;
        finishSummary = tc.input.summary || "";
        finalOutput += `\nFINISH: ${finishSummary}`;
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

    if (response.stopReason === "end_turn" && response.toolCalls.length === 0) {
      done = true;
    }
  }

  return { output: finalOutput.trim(), finishSummary, turns };
}
