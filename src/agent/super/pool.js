// src/agent/super/pool.js
// Agent Pool — persistent capability registry + institutional memory

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Pool lives in ~/.quark/pool/ — persists across projects
const POOL_ROOT = join(homedir(), ".quark", "pool");
const AGENTS_DIR = join(POOL_ROOT, "agents");
const LEARNINGS_DIR = join(POOL_ROOT, "learnings");

function ensurePool() {
  [POOL_ROOT, AGENTS_DIR, LEARNINGS_DIR].forEach(d => {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  });
}

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

// ── Built-in agent definitions ─────────────────────────────────────────────
// Seeded on first run. Users can extend via pool_add.

const BUILTIN_AGENTS = {
  "planner": {
    role: "Planner", role_slug: "planner",
    capability_keys: ["planning", "architecture", "decomposition", "requirements"],
    description: "Creates detailed implementation plans and breaks tasks into executable steps.",
    system_prompt_delta: "Always output a numbered implementation plan before any code. Be explicit about dependencies between steps. Identify risks upfront.",
    watchdog_defaults: { min_output_length: 200, required_signals: ["numbered plan", "steps"] },
  },
  "coder": {
    role: "Coder", role_slug: "coder",
    capability_keys: ["coding", "implementation", "python", "javascript", "typescript", "react", "fastapi"],
    description: "Writes clean, working code based on a plan. Does not design — only implements.",
    system_prompt_delta: "Write complete, runnable code. Never use placeholders like '// TODO' or '...'. Always include imports. Handle errors explicitly. Do not explain — just write the code.",
    watchdog_defaults: { min_output_length: 300, required_signals: ["code block", "import"] },
  },
  "backend-specialist": {
    role: "Backend Specialist", role_slug: "backend-specialist",
    capability_keys: ["fastapi", "mongodb", "motor", "jwt", "pydantic", "api-design", "rest", "python", "postgres", "redis"],
    description: "Builds backend API routes, database models, and business logic.",
    system_prompt_delta: "Use Pydantic v2. Async endpoints. Structured JSON error responses. Never expose internal errors. Always prefix routes with /api. Use motor for MongoDB async.",
    watchdog_defaults: { min_output_length: 300, required_signals: ["route", "async def", "except"] },
  },
  "frontend-specialist": {
    role: "Frontend Specialist", role_slug: "frontend-specialist",
    capability_keys: ["react", "typescript", "tailwind", "shadcn", "ui-ux", "next.js", "vite", "state-management"],
    description: "Builds React components and frontend logic with modern tooling.",
    system_prompt_delta: "TypeScript always. No inline styles — Tailwind only. Every interactive element needs loading, error, and success states. No dead buttons. Use shadcn/ui components when available.",
    watchdog_defaults: { min_output_length: 400, required_signals: ["const ", "return (", "useState"] },
  },
  "tester": {
    role: "Tester", role_slug: "tester",
    capability_keys: ["testing", "pytest", "jest", "vitest", "unit-tests", "integration-tests", "coverage"],
    description: "Writes and runs tests for code produced by other agents.",
    system_prompt_delta: "Write tests that actually test behavior, not implementation. Aim for edge cases. Each test must have a clear assertion. Name tests descriptively.",
    watchdog_defaults: { min_output_length: 200, required_signals: ["test", "assert", "def test_"] },
  },
  "reviewer": {
    role: "Reviewer", role_slug: "reviewer",
    capability_keys: ["code-review", "quality", "security", "performance", "best-practices"],
    description: "Reviews code for bugs, security issues, performance, and style.",
    system_prompt_delta: "Output a structured review: BUGS, SECURITY, PERFORMANCE, STYLE. Be specific — cite line content. Suggest concrete fixes, not vague advice.",
    watchdog_defaults: { min_output_length: 150, required_signals: ["bug", "security", "fix"] },
  },
  "debugger": {
    role: "Debugger", role_slug: "debugger",
    capability_keys: ["debugging", "error-analysis", "stack-traces", "logs"],
    description: "Analyzes errors, stack traces, and logs to identify and fix bugs.",
    system_prompt_delta: "Always start with root cause analysis. Do not guess — trace the error. Output: ROOT CAUSE → EVIDENCE → FIX. Apply the fix after diagnosis.",
    watchdog_defaults: { min_output_length: 150, required_signals: ["root cause", "fix"] },
  },
  "schema-designer": {
    role: "Schema Designer", role_slug: "schema-designer",
    capability_keys: ["schema-design", "data-modeling", "mongodb", "postgres", "relationships", "indexing"],
    description: "Designs database schemas, models, and indexing strategies.",
    system_prompt_delta: "Design for scalability first. Always define indexes for query fields. Document every field. For MongoDB: embedded docs for 1:1, refs for high-cardinality 1:N.",
    watchdog_defaults: { min_output_length: 100, required_signals: ["schema", "index", "field"] },
  },
  "security-auditor": {
    role: "Security Auditor", role_slug: "security-auditor",
    capability_keys: ["security", "jwt", "auth", "injection-prevention", "rate-limiting", "cors", "owasp"],
    description: "Reviews code for security vulnerabilities and implements controls.",
    system_prompt_delta: "Check for: injection (SQL/NoSQL/XSS), CORS misconfiguration, exposed secrets, missing auth middleware, unvalidated inputs. Output structured findings then apply fixes.",
    watchdog_defaults: { min_output_length: 150, required_signals: ["finding", "fix", "vulnerability"] },
  },
  "docs-writer": {
    role: "Docs Writer", role_slug: "docs-writer",
    capability_keys: ["documentation", "readme", "api-docs", "markdown", "openapi"],
    description: "Writes clear, accurate documentation for code and APIs.",
    system_prompt_delta: "Write for the reader, not the author. Include examples for every API endpoint. Keep README concise. Use tables for comparison data.",
    watchdog_defaults: { min_output_length: 200, required_signals: ["##", "```", "example"] },
  },
};

// ── Pool operations ────────────────────────────────────────────────────────

export function initPool() {
  ensurePool();
  // Seed built-in agents if pool is empty
  for (const [slug, def] of Object.entries(BUILTIN_AGENTS)) {
    const path = join(AGENTS_DIR, `${slug}.json`);
    if (!existsSync(path)) {
      writeJSON(path, {
        ...def,
        preferred_tools: ["execute_bash", "mcp_create_file", "mcp_bulk_file_writer", "mcp_view_file", "mcp_search_replace"],
        performance: { sessions_completed: 0, avg_watchdog_score: null, common_failures: [], respawn_rate: 0 },
        status: "active",
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        version: 1,
      });
    }
  }
}

export function listAgents() {
  ensurePool();
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => readJSON(join(AGENTS_DIR, f)))
    .filter(Boolean)
    .filter(a => a.status !== "deprecated");
}

export function getAgent(roleSlug) {
  ensurePool();
  const path = join(AGENTS_DIR, `${roleSlug}.json`);
  return readJSON(path);
}

export function queryByCapability(keyword, minScore = 0) {
  const agents = listAgents();
  return agents
    .filter(a => {
      const keys = a.capability_keys || [];
      const kwLower = keyword.toLowerCase();
      return keys.some(k => k.includes(kwLower) || kwLower.includes(k));
    })
    .filter(a => {
      const score = a.performance?.avg_watchdog_score ?? 1; // new agents get full score
      return score >= minScore;
    })
    .sort((a, b) => {
      const sa = a.performance?.avg_watchdog_score ?? 1;
      const sb = b.performance?.avg_watchdog_score ?? 1;
      return sb - sa;
    });
}

export function addAgent(def) {
  ensurePool();
  const path = join(AGENTS_DIR, `${def.role_slug}.json`);
  const agent = {
    ...def,
    performance: { sessions_completed: 0, avg_watchdog_score: null, common_failures: [], respawn_rate: 0 },
    status: "active",
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    version: 1,
  };
  writeJSON(path, agent);
  return agent;
}

export function updateAgentScore(roleSlug, sessionScore, learning = null) {
  ensurePool();
  const path = join(AGENTS_DIR, `${roleSlug}.json`);
  const agent = readJSON(path);
  if (!agent) return null;

  const sessions = (agent.performance.sessions_completed || 0) + 1;
  const prevAvg = agent.performance.avg_watchdog_score ?? sessionScore;
  const newAvg = parseFloat(((prevAvg * (sessions - 1) + sessionScore) / sessions).toFixed(3));

  agent.performance.sessions_completed = sessions;
  agent.performance.last_session_score = sessionScore;
  agent.performance.avg_watchdog_score = newAvg;

  if (learning) {
    agent.system_prompt_delta = (agent.system_prompt_delta || "") + " " + learning;
  }

  agent.last_updated = new Date().toISOString();
  agent.version = (agent.version || 1) + 1;
  writeJSON(path, agent);
  return agent;
}

export function saveLearning(sessionId, content) {
  ensurePool();
  const filename = `${new Date().toISOString().slice(0, 10)}-${sessionId}.md`;
  writeFileSync(join(LEARNINGS_DIR, filename), content, "utf8");
}

export function getPoolPath() { return POOL_ROOT; }
