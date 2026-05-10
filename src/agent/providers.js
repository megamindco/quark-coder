// src/agent/providers.js
// Unified LLM provider — Anthropic native, OpenRouter + GLM via OpenAI-compat
// Full Anthropic↔OpenAI-compat bidirectional format handling with GLM quirk layer

// ── Provider registry ──────────────────────────────────────────────────────

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    defaultModel: "claude-opus-4-5",
    supportsTools: true,
    models: [
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-haiku-4-5-20251001",
    ],
    keyEnv: "ANTHROPIC_API_KEY",
    keyName: "Anthropic API key",
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "anthropic/claude-opus-4",
    supportsTools: true,
    models: [
      "anthropic/claude-opus-4",
      "anthropic/claude-sonnet-4-5",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
      "x-ai/grok-3",
      "deepseek/deepseek-r1",
      "deepseek/deepseek-v3",
      "meta-llama/llama-3.3-70b-instruct",
      "mistralai/mistral-large-2411",
      "qwen/qwq-32b",
      "microsoft/phi-4",
    ],
    keyEnv: "OPENROUTER_API_KEY",
    keyName: "OpenRouter API key",
  },
  glm: {
    label: "Z.ai GLM / CodeGeeX",
    defaultModel: "codegeex-4",
    supportsTools: true,
    // glm-4-* → native tool calling via OpenAI-compat
    // codegeex-* + custom fine-tunes → Anthropic-format internal history, XML text-fallback for tools
    toolCapableModels: ["glm-4-plus", "glm-4-long", "glm-4-flash", "glm-4-air", "glm-4"],
    models: [
      "codegeex-4",     // code-optimised, XML tool fallback
      "glm-4-plus",     // native tool use
      "glm-4-long",     // 128k context, native tool use
      "glm-4-flash",    // fast, native tool use
      "glm-4-air",      // lightweight, native tool use
      "glm-4",          // base, native tool use
      // Any custom fine-tune string also works — e.g. "glm-4-plus-ft:your-model-id"
    ],
    keyEnv: "GLM_API_KEY",
    keyName: "Z.ai GLM API key",
    customModelNote: "Any model string accepted. glm-4-* uses native tools; others use Anthropic-format XML fallback.",
  },
};

// glm-4-* → native OpenAI-compat tool calling
// codegeex-* + custom strings → Anthropic-format internal history, XML text-fallback for tools
function glmSupportsNativeTools(model) {
  if (!model) return false;
  // Strip fine-tune suffix: "glm-4-plus-ft:abc123" → "glm-4-plus-ft"
  const base = model.split(":")[0];
  return base === "glm-4" || base.startsWith("glm-4-");
}

// ── Anthropic → OpenAI-compat message format ───────────────────────────────
//
// Anthropic format:
//   assistant: [{type:"text", text:""}, {type:"tool_use", id, name, input:{}}]
//   user (tool results): [{type:"tool_result", tool_use_id, content:""}]
//
// OpenAI-compat format:
//   assistant: {role:"assistant", content:"text", tool_calls:[{id, type:"function", function:{name, arguments}}]}
//   tool result: {role:"tool", tool_call_id, content:"string"}

function toOpenAIMessages(messages, systemPrompt) {
  const out = [];

  if (systemPrompt) {
    out.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {

    // ── Tool result turns (user with tool_result blocks) ─────────────────
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const toolResults = msg.content.filter(b => b.type === "tool_result");
      const textBlocks  = msg.content.filter(b => b.type === "text");

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          // Normalize content to non-empty string (GLM rejects empty)
          let content = "";
          if (typeof tr.content === "string") {
            content = tr.content;
          } else if (Array.isArray(tr.content)) {
            content = tr.content
              .map(b => (typeof b === "string" ? b : b?.text || JSON.stringify(b)))
              .join("");
          } else if (tr.content != null) {
            content = JSON.stringify(tr.content);
          }
          content = content || "{}"; // GLM rejects empty tool results

          out.push({
            role: "tool",
            tool_call_id: tr.tool_use_id || `tool_${Date.now()}`,
            content,
          });
        }
        // Text alongside tool results → separate user message
        if (textBlocks.length) {
          const text = textBlocks.map(b => b.text || "").join("");
          if (text.trim()) out.push({ role: "user", content: text });
        }
        continue;
      }

      // Plain user message with text blocks
      const text = textBlocks.map(b => b.text || "").join("");
      out.push({ role: "user", content: text || "" });
      continue;
    }

    // ── Plain string user message ─────────────────────────────────────────
    if (msg.role === "user" && typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content });
      continue;
    }

    // ── Assistant message ─────────────────────────────────────────────────
    if (msg.role === "assistant") {
      const content     = Array.isArray(msg.content) ? msg.content : [];
      const textBlocks  = content.filter(b => b.type === "text");
      const toolBlocks  = content.filter(b => b.type === "tool_use");
      const textContent = textBlocks.map(b => b.text || "").join("");

      const tool_calls = toolBlocks.map(b => ({
        id: b.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: "function",
        function: {
          name: b.name,
          // GLM requires arguments as a valid JSON string, never undefined
          arguments: typeof b.input === "string"
            ? b.input
            : JSON.stringify(b.input ?? {}),
        },
      }));

      const assistantMsg = {
        role: "assistant",
        // GLM quirk: content must be null (not "") when tool_calls present
        content: tool_calls.length > 0 ? (textContent || null) : textContent,
      };

      if (tool_calls.length > 0) assistantMsg.tool_calls = tool_calls;
      out.push(assistantMsg);
      continue;
    }
  }

  return out;
}

// ── GLM text-fallback tool encoding ────────────────────────────────────────
// For GLM models that don't natively support function calling (e.g. codegeex-4),
// encode tool availability in the system prompt and parse tool calls from text.

function buildGLMTextFallbackSystem(systemPrompt, tools) {
  if (!tools?.length) return systemPrompt;

  const toolDescs = tools.map(t => {
    const props = Object.entries(t.input_schema?.properties || {})
      .map(([k, v]) => `    ${k} (${v.type || "string"}): ${v.description || ""}`)
      .join("\n");
    return `TOOL: ${t.name}\n  Description: ${t.description}\n  Parameters:\n${props}`;
  }).join("\n\n");

  return `${systemPrompt}

## Available Tools (respond using XML tags)

${toolDescs}

When you want to use a tool, output it in this exact format (on its own line):
<tool_call>{"name":"tool_name","input":{"param":"value"}}</tool_call>

After receiving a tool result, it will appear as:
<tool_result>{"result":"...","success":true}</tool_result>

Continue reasoning after seeing tool results. Call finish when done.`;
}

function parseGLMTextFallbackResponse(text) {
  const toolCalls = [];
  // Extract all <tool_call>{...}</tool_call> blocks
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name) {
        toolCalls.push({
          id: `call_text_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          name: parsed.name,
          input: parsed.input || parsed.parameters || {},
        });
      }
    } catch { /* skip malformed */ }
  }

  // Clean text: remove tool_call blocks
  const cleanText = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();

  const rawContent = [];
  if (cleanText) rawContent.push({ type: "text", text: cleanText });
  for (const tc of toolCalls) {
    rawContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
  }

  return {
    text: cleanText,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    rawContent,
  };
}

// ── OpenAI-compat response parser ──────────────────────────────────────────

function parseOpenAIResponse(data) {
  const choice = data.choices?.[0];
  if (!choice) {
    const errorMsg = data.error?.message || data.message || "No choices in response";
    throw new Error(errorMsg);
  }

  const msg = choice.message || {};
  const rawText = msg.content || "";
  const rawToolCalls = msg.tool_calls || [];

  const toolCalls = rawToolCalls.map((tc, idx) => {
    let input = {};
    const argsStr = tc.function?.arguments;
    if (argsStr) {
      try {
        input = JSON.parse(argsStr);
      } catch {
        // Try to extract valid JSON from potentially truncated args
        const fixed = argsStr.replace(/,?\s*$/, "") + "}";
        try { input = JSON.parse(fixed); }
        catch { input = { _raw: argsStr }; }
      }
    }
    return {
      id: tc.id || `call_${Date.now()}_${idx}`,
      name: tc.function?.name || "unknown",
      input,
    };
  });

  const rawContent = [];
  if (rawText) rawContent.push({ type: "text", text: rawText });
  for (const tc of toolCalls) {
    rawContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
  }

  const finishReason = choice.finish_reason;
  const stopReason =
    finishReason === "tool_calls" || finishReason === "function_call"
      ? "tool_use"
      : "end_turn";

  return { text: rawText, toolCalls, stopReason, rawContent };
}

// ── GLM message sanitizer ──────────────────────────────────────────────────
// GLM is strict about message ordering. Sanitize before sending.

function sanitizeGLMMessages(messages) {
  const out = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Fix: GLM rejects tool messages not immediately after assistant with tool_calls
    if (msg.role === "tool") {
      // Ensure previous message was assistant with tool_calls
      const prev = out[out.length - 1];
      if (!prev || prev.role !== "assistant" || !prev.tool_calls?.length) {
        // Skip orphaned tool results (GLM would reject them)
        continue;
      }

      // Verify tool_call_id exists in the previous assistant's tool_calls
      const prevIds = prev.tool_calls.map(tc => tc.id);
      if (!prevIds.includes(msg.tool_call_id)) {
        // Remap to first available id if mismatch
        const fixedMsg = { ...msg, tool_call_id: prevIds[0] || msg.tool_call_id };
        out.push(fixedMsg);
        continue;
      }
    }

    // Fix: GLM rejects consecutive user messages — merge them
    if (msg.role === "user" && out.length > 0 && out[out.length - 1].role === "user") {
      const last = out[out.length - 1];
      out[out.length - 1] = {
        ...last,
        content: (last.content || "") + "\n" + (msg.content || ""),
      };
      continue;
    }

    // Fix: GLM rejects empty-string content on user/system messages
    if ((msg.role === "user" || msg.role === "system") && msg.content === "") {
      out.push({ ...msg, content: " " });
      continue;
    }

    out.push(msg);
  }

  return out;
}

// ── Provider implementations ───────────────────────────────────────────────

async function callAnthropic({ apiKey, model, systemPrompt, messages, tools }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const resp = await client.messages.create({
    model,
    max_tokens: 8096,
    system: systemPrompt,
    tools: tools?.length ? tools : undefined,
    messages,
  });

  const textBlocks = resp.content.filter(b => b.type === "text");
  const toolBlocks = resp.content.filter(b => b.type === "tool_use");

  return {
    text: textBlocks.map(b => b.text).join(""),
    toolCalls: toolBlocks.map(b => ({ id: b.id, name: b.name, input: b.input })),
    stopReason: resp.stop_reason,
    rawContent: resp.content,
  };
}

async function callOpenAICompat({
  baseURL,
  apiKey,
  model,
  systemPrompt,
  messages,
  tools,
  extraHeaders = {},
  glmMode = false,
  preConverted = false,   // true = messages already in OpenAI format, skip toOpenAIMessages
}) {
  // If preConverted, messages are already [{role,content},...] — just prepend system
  let openaiMessages;
  if (preConverted) {
    openaiMessages = [
      { role: "system", content: systemPrompt || "" },
      ...messages,
    ];
  } else {
    openaiMessages = toOpenAIMessages(messages, systemPrompt);
  }
  const sanitized = glmMode ? sanitizeGLMMessages(openaiMessages) : openaiMessages;

  const openaiTools = tools?.length
    ? tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description || "",
          parameters: t.input_schema || { type: "object", properties: {} },
        },
      }))
    : undefined;

  const body = {
    model,
    max_tokens: 8096,
    messages: sanitized,
  };

  if (openaiTools?.length) {
    body.tools = openaiTools;
    body.tool_choice = "auto";
    if (glmMode) {
      // GLM quirks: disable parallel tool calls, it causes confusion
      body.parallel_tool_calls = false;
    }
  }

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "network error");
    let errMsg = errText;
    try {
      const errJson = JSON.parse(errText);
      // GLM error format: { error: { code, message } } or { message }
      errMsg = errJson.error?.message || errJson.message || errText;
    } catch { /* use raw */ }
    throw new Error(`HTTP ${resp.status} from ${baseURL.split("/")[2]}: ${errMsg}`);
  }

  const data = await resp.json();
  return parseOpenAIResponse(data);
}

async function callOpenRouter({ apiKey, model, systemPrompt, messages, tools, siteUrl, siteName }) {
  return callOpenAICompat({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    model,
    systemPrompt,
    messages,
    tools,
    extraHeaders: {
      "HTTP-Referer": siteUrl || "https://megamindco.com",
      "X-Title": siteName || "Quark Agent — MMC",
    },
  });
}

async function callGLM({ apiKey, model, systemPrompt, messages, tools }) {
  const usesNativeTools = glmSupportsNativeTools(model);

  if (usesNativeTools) {
    // GLM-4 family: use native OpenAI-compat tool calling
    return callOpenAICompat({
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      apiKey,
      model,
      systemPrompt,
      messages,
      tools,
      glmMode: true,
    });
  } else {
    // codegeex-4 and other non-tool-native GLM models:
    // Convert Anthropic messages → plain text (tool calls as XML, tool results as XML)
    const augmentedSystem = buildGLMTextFallbackSystem(systemPrompt, tools);
    const textMessages = injectTextToolResults(messages); // now [{role, content:string}]

    const resp = await callOpenAICompat({
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      apiKey,
      model,
      systemPrompt: augmentedSystem,
      messages: textMessages,
      tools: [],         // no native tools — handled via text
      glmMode: true,
      preConverted: true, // messages already in {role, content:string} form
    });

    // Parse tool calls embedded as XML in the text response
    if (resp.text) {
      return parseGLMTextFallbackResponse(resp.text);
    }
    return resp;
  }
}

// Convert Anthropic-format messages → plain text [{role, content:string}] for text-fallback models.
// This produces messages safe to send with preConverted:true (skipping toOpenAIMessages).
function injectTextToolResults(messages) {
  const out = [];
  for (const msg of messages) {
    // ── Tool result turns (user with tool_result blocks) ─────────────────
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const toolResults = msg.content.filter(b => b.type === "tool_result");
      const textBlocks  = msg.content.filter(b => b.type === "text");

      if (toolResults.length > 0) {
        // Serialize each tool result as XML
        const xmlParts = toolResults.map(tr => {
          const content = typeof tr.content === "string"
            ? tr.content
            : JSON.stringify(tr.content || {});
          return `<tool_result id="${tr.tool_use_id || ""}">${content}</tool_result>`;
        });
        // Append any text alongside tool results
        const textParts = textBlocks.map(b => b.text || "").filter(Boolean);
        out.push({ role: "user", content: [...xmlParts, ...textParts].join("\n") });
        continue;
      }

      // Plain user message — join text blocks
      const text = textBlocks.map(b => b.text || "").join("");
      out.push({ role: "user", content: text || " " });
      continue;
    }

    // ── Plain string user message ─────────────────────────────────────────
    if (msg.role === "user" && typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content || " " });
      continue;
    }

    // ── Assistant message — serialize tool_use blocks as XML ──────────────
    if (msg.role === "assistant") {
      const content = Array.isArray(msg.content) ? msg.content : [];
      const parts = content.map(b => {
        if (b.type === "text") return b.text || "";
        if (b.type === "tool_use") {
          return `<tool_call>${JSON.stringify({ name: b.name, input: b.input })}</tool_call>`;
        }
        return "";
      }).filter(Boolean);
      out.push({ role: "assistant", content: parts.join("") || " " });
      continue;
    }

    // Passthrough (system etc.)
    out.push(msg);
  }
  return out;
}

// ── Unified dispatcher ─────────────────────────────────────────────────────

export async function callProvider({
  provider,
  apiKey,
  model,
  systemPrompt,
  messages,
  tools,
  providerConfig = {},
}) {
  if (!apiKey) throw new Error(`No API key configured for provider: ${provider}`);

  switch (provider) {
    case "anthropic":
      return callAnthropic({ apiKey, model, systemPrompt, messages, tools });
    case "openrouter":
      return callOpenRouter({ apiKey, model, systemPrompt, messages, tools, ...providerConfig });
    case "glm":
      return callGLM({ apiKey, model, systemPrompt, messages, tools });
    default:
      throw new Error(`Unknown provider: "${provider}". Valid: ${Object.keys(PROVIDERS).join(", ")}`);
  }
}

// NOTE: getProviderKey lives in config.js — not exported from providers.js
// to avoid circular deps and dual-source-of-truth for stored keys.

/**
 * Call a provider with an explicit single user message (no history).
 * Used by Super Agent sub-agents for one-shot specialized tasks.
 */
export async function callProviderOnce({
  provider, apiKey, model, systemPrompt, userMessage, tools = [], providerConfig = {},
}) {
  return callProvider({
    provider, apiKey, model,
    systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools,
    providerConfig,
  });
}

/**
 * Detect if a GLM model supports native tool calling.
 * Exported for use in Super Agent's agent-pool capability checks.
 */
export { glmSupportsNativeTools };
