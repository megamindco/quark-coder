// src/agent/runner.js
// Multi-provider agentic loop

import chalk from "chalk";
import ora from "ora";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";
import { callProvider, PROVIDERS } from "./providers.js";

const BRAND = "#00CFFF";
const MAX_TURNS = 40;

function printText(text) {
  if (text?.trim()) console.log("\n" + chalk.white(text));
}

function printToolCall(name, input) {
  const lines = {
    think:               `  ◈  ${chalk.dim("thinking...")}`,
    execute_bash:        `  ⚙  bash: ${chalk.yellow((input.command || "").slice(0, 80))}`,
    mcp_view_file:       `  📄 read: ${chalk.cyan(input.path)}`,
    mcp_create_file:     `  ✎  create: ${chalk.cyan(input.path)}`,
    mcp_bulk_file_writer:`  ✎  write: ${chalk.cyan(String(input.files?.length) + " files")}`,
    mcp_search_replace:  `  ✎  edit: ${chalk.cyan(input.path)}`,
    mcp_glob_files:      `  🔍 glob: ${input.pattern}`,
    grep_tool:           `  🔍 grep: "${input.pattern}" in ${input.path}`,
    ask_human:           `\n  ${chalk.hex(BRAND)("?")} ${input.question}`,
    finish:              `  ${chalk.hex(BRAND)("✦")} Finish`,
  };
  console.log(chalk.dim(lines[name] || `  ⚙  ${name}`));
}

function printToolResult(name, result) {
  if (name === "think" || name === "ask_human") return;
  if (name === "finish") {
    console.log("\n" + chalk.hex(BRAND)("✦ ") + chalk.white(result.summary));
    return;
  }
  if (result?.error) {
    console.log(chalk.red(`  ✗ ${result.error}`));
    return;
  }
  if (result?.stdout?.trim()) {
    const out = result.stdout.slice(0, 600).trim();
    console.log(chalk.dim("  " + out.split("\n").join("\n  ")));
  }
  if (result?.stderr && !result?.success) {
    console.log(chalk.yellow("  ⚠ " + result.stderr.slice(0, 300)));
  }
  if (result?.success === true && !result?.stdout) {
    console.log(chalk.dim("  ✓ ok"));
  }
  if (result?.results) {
    for (const r of result.results) {
      console.log(chalk.dim(`  ${r.success ? "✓" : "✗"} ${r.path}`));
    }
  }
}

// ── Main runner ────────────────────────────────────────────────────────────

export async function runAgent({
  task,
  apiKey,
  provider = "anthropic",
  model,
  cwd = process.cwd(),
  providerConfig = {},
}) {
  const providerDef = PROVIDERS[provider];
  const resolvedModel = model || providerDef?.defaultModel || "claude-opus-4-5";

  console.log(chalk.hex(BRAND)("\n  ⬡ Quark Agent\n"));
  console.log(chalk.dim("  Provider: ") + chalk.white(providerDef?.label || provider));
  console.log(chalk.dim("  Model:    ") + chalk.white(resolvedModel));
  console.log(chalk.dim("  Task:     ") + chalk.white(task));
  console.log(chalk.dim("  Dir:      ") + chalk.white(cwd));
  console.log();

  // History kept in Anthropic message format internally
  const messages = [{ role: "user", content: task }];
  let turns = 0;
  let done = false;

  while (!done && turns < MAX_TURNS) {
    turns++;

    const spinner = ora({
      text: `Turn ${turns}/${MAX_TURNS}...`,
      color: "cyan",
      spinner: "dots",
    }).start();

    let response;
    try {
      response = await callProvider({
        provider,
        apiKey,
        model: resolvedModel,
        systemPrompt: SYSTEM_PROMPT,
        messages,
        tools: TOOL_DEFINITIONS,
        providerConfig,
      });
    } catch (err) {
      spinner.stop();
      console.error(chalk.red("\n  ✗ LLM error: ") + err.message);
      break;
    }

    spinner.stop();
    printText(response.text);

    // Append assistant message using rawContent (always in Anthropic format)
    messages.push({ role: "assistant", content: response.rawContent });

    // Execute tool calls
    const toolResults = [];
    for (const tc of response.toolCalls) {
      printToolCall(tc.name, tc.input);
      const result = await executeTool(tc.name, tc.input, cwd);
      printToolResult(tc.name, result);
      if (tc.name === "finish") done = true;
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

  if (turns >= MAX_TURNS) {
    console.log(chalk.yellow("\n  ⚠ Max turns reached. Agent stopped."));
  }
  console.log(chalk.dim("\n  Session ended.\n"));
}
