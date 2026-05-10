// src/agent/pool.js
// Local Agent Pool — persistent capability registry + institutional memory
// Stored at: {cwd}/.quark/pool/  (project-local) or ~/.quark/pool/ (global)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

// ── Directory resolution ───────────────────────────────────────────────────

export function getPoolDir(cwd = process.cwd()) {
  // Prefer project-local pool; fall back to global
  const local = join(cwd, ".quark", "pool");
  const global_ = join(homedir(), ".quark", "pool");
  return existsSync(local) ? local : global_;
}

function ensurePool(poolDir) {
  for (const sub of ["agents", "learnings", "patterns", "manifests"]) {
    const d = join(poolDir, sub);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function writeJSON(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

// ── Default agents (pre-seeded) ────────────────────────────────────────────

const DEFAULT_AGENTS = {
  "backend-specialist": {
    role: "Backend Specialist", role_slug: "backend-specialist",
    capability_keys: ["fastapi", "mongodb", "motor", "jwt", "pydantic", "api-design", "rest", "python", "backend"],
    description: "Builds backend API routes, database models, and business logic.",
    system_prompt_delta: "Always use Pydantic v2. Use motor (async) for MongoDB. Structured JSON error responses. Never expose internals. Prefix all routes with /api.",
    performance: { sessions_completed: 0, avg_watchdog_score: null, common_failures: [], respawn_rate: 0 },
    watchdog_defaults: { min_output_length: 300, required_artifacts: [], quality_signals: ["error handling", "input validation"] },
    status: "active", version: 1,
  },
  "frontend-specialist": {
    role: "Frontend Specialist", role_slug: "frontend-specialist",
    capability_keys: ["react", "typescript", "tailwind", "shadcn", "ui-ux", "next.js", "frontend", "components"],
    description: "Builds React components, pages, and frontend logic.",
    system_prompt_delta: "Use shadcn/ui components. TypeScript throughout. No dead buttons — all interactive elements must have loading, error, and success states.",
    performance: { sessions_completed: 0, avg_watchdog_score: null, common_failures: [], respawn_rate: 0 },
    watchdog_defaults: { min_output_length: 400, required_artifacts: [], quality_signals: ["TypeScript types", "loading states"] },
    status: "active", version: 1,
  },
  "security-auditor": {
    role: "Security Auditor", role_slug: "security-auditor",
    capability_keys: ["security", "jwt", "auth", "injection", "cors", "rate-limiting", "owasp"],
    description: "Reviews code for security vulnerabilities and implements controls.",
    system_prompt_delta: "Check for: injection, XSS, CORS misconfiguration, exposed secrets, missing auth. Output structured findings list before fixes.",
    performance: { sessions_completed: 0, avg_watchdog_score: null, common_failures: [], respawn_rate: 0 },
    watchdog_defaults: { min_output_length: 200, required_artifacts: ["security findings"], quality_signals: ["findings documented"] },
    status: "active", version: 1,
  },
  "schema-designer": {
    role: "Schema Designer", role_slug: "schema-designer",
    capability_keys: ["mongodb", "schema-design", "data-modeling", "indexing", "relationships", "database"],
    description: "Designs database schemas, models, and indexing strategies.",
    system_prompt_delta: "Design for scalability. Define indexes for all query fields. Document every field. For MongoDB: embedded for 1:1, references for high-cardinality 1:N.",
    performance: { sessions_completed: 0, avg_watchdog_score: null, common_failures: [], respawn_rate: 0 },
    watchdog_defaults: { min_output_length: 150, required_artifacts: [], quality_signals: ["indexes defined", "fields documented"] },
    status: "active", version: 1,
  },
  "planner": {
    role: "Planner", role_slug: "planner",
    capability_keys: ["planning", "architecture", "decomposition", "requirements", "design"],
    description: "Creates detailed implementation plans and architectural designs.",
    system_prompt_delta: "Produce numbered, actionable steps. Include file paths, function signatures, and data flows. Never skip edge cases.",
    performance: { sessions_completed: 0, avg_watchdog_score: null, common_failures: [], respawn_rate: 0 },
    watchdog_defaults: { min_output_length: 400, required_artifacts: [], quality_signals: ["numbered steps", "file paths mentioned"] },
    status: "active", version: 1,
  },
  "tester": {
    role: "Tester", role_slug: "tester",
    capability_keys: ["testing", "pytest", "jest", "vitest", "unit-tests", "integration-tests", "tdd"],
    description: "Writes and runs tests, ensures quality coverage.",
    system_prompt_delta: "Write tests that actually test behavior, not implementation. Include edge cases, error paths, and happy paths. Aim for >80% coverage of new code.",
    performance: { sessions_completed: 0, avg_watchdog_score: null, common_failures: [], respawn_rate: 0 },
    watchdog_defaults: { min_output_length: 200, required_artifacts: [], quality_signals: ["edge cases covered", "error paths tested"] },
    status: "active", version: 1,
  },
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize pool — ensure directories and seed default agents
 */
export function initPool(cwd = process.cwd()) {
  const poolDir = join(cwd, ".quark", "pool");
  ensurePool(poolDir);

  // Seed defaults if pool is empty
  const agentsDir = join(poolDir, "agents");
  const existing = existsSync(agentsDir) ? readdirSync(agentsDir).filter(f => f.endsWith(".json")) : [];

  if (existing.length === 0) {
    for (const [slug, agent] of Object.entries(DEFAULT_AGENTS)) {
      const now = new Date().toISOString();
      writeJSON(join(agentsDir, `${slug}.json`), {
        ...agent,
        created_at: now,
        last_updated: now,
      });
    }
  }

  return poolDir;
}

/**
 * Query agents by capability keyword
 */
export function queryAgents(capability, poolDir, minScore = 0) {
  const agentsDir = join(poolDir, "agents");
  if (!existsSync(agentsDir)) return [];

  const files = readdirSync(agentsDir).filter(f => f.endsWith(".json"));
  const keyword = capability.toLowerCase();

  return files
    .map(f => readJSON(join(agentsDir, f)))
    .filter(a => {
      if (!a || a.status === "deprecated") return false;
      const keys = (a.capability_keys || []).map(k => k.toLowerCase());
      const matches = keys.some(k => k.includes(keyword) || keyword.includes(k));
      const score = a.performance?.avg_watchdog_score ?? 1; // new agents get benefit of doubt
      return matches && score >= minScore;
    })
    .sort((a, b) => (b.performance?.avg_watchdog_score ?? 1) - (a.performance?.avg_watchdog_score ?? 1));
}

/**
 * Get agent by role slug
 */
export function getAgent(roleSlug, poolDir) {
  const path = join(poolDir, "agents", `${roleSlug}.json`);
  return readJSON(path);
}

/**
 * Get all agents
 */
export function getAllAgents(poolDir) {
  const agentsDir = join(poolDir, "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter(f => f.endsWith(".json"))
    .map(f => readJSON(join(agentsDir, f)))
    .filter(a => a && a.status !== "deprecated");
}

/**
 * Add or update agent
 */
export function upsertAgent(agent, poolDir) {
  const slug = agent.role_slug || agent.role.toLowerCase().replace(/\s+/g, "-");
  const path = join(poolDir, "agents", `${slug}.json`);
  const existing = readJSON(path) || {};
  const now = new Date().toISOString();
  writeJSON(path, {
    ...existing,
    ...agent,
    role_slug: slug,
    last_updated: now,
    created_at: existing.created_at || now,
    version: (existing.version || 0) + 1,
  });
  return slug;
}

/**
 * Update agent performance after a Watchdog-validated session
 */
export function updatePerformance(roleSlug, sessionScore, learning, poolDir) {
  const path = join(poolDir, "agents", `${roleSlug}.json`);
  const agent = readJSON(path);
  if (!agent) return false;

  const perf = agent.performance || {};
  const sessions = (perf.sessions_completed || 0) + 1;
  const prevAvg = perf.avg_watchdog_score ?? sessionScore;
  const newAvg = parseFloat(((prevAvg * (sessions - 1) + sessionScore) / sessions).toFixed(3));

  agent.performance = {
    ...perf,
    sessions_completed: sessions,
    last_session_score: sessionScore,
    avg_watchdog_score: newAvg,
  };

  if (learning?.trim()) {
    agent.system_prompt_delta = [agent.system_prompt_delta, learning].filter(Boolean).join(" ");
  }

  agent.last_updated = new Date().toISOString();
  agent.version = (agent.version || 1) + 1;
  writeJSON(path, agent);
  return true;
}

/**
 * Save a session learning
 */
export function saveLearning(sessionId, learning, poolDir) {
  const date = new Date().toISOString().slice(0, 10);
  const path = join(poolDir, "learnings", `${date}-${sessionId}.md`);
  writeFileSync(path, `# Learning: ${date}\n\n**Session:** ${sessionId}\n\n${learning}\n`, "utf8");
}

/**
 * Save manifest
 */
export function saveManifest(manifest, poolDir) {
  const path = join(poolDir, "manifests", `${manifest.manifest_id}.json`);
  writeJSON(path, manifest);
  return path;
}

/**
 * Load manifest
 */
export function loadManifest(manifestId, poolDir) {
  const path = join(poolDir, "manifests", `${manifestId}.json`);
  return readJSON(path);
}

/**
 * Update manifest (e.g. with watchdog results)
 */
export function updateManifest(manifestId, updates, poolDir) {
  const path = join(poolDir, "manifests", `${manifestId}.json`);
  const manifest = readJSON(path) || {};
  writeJSON(path, { ...manifest, ...updates });
}
