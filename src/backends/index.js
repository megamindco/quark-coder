// src/backends/index.js
import { execa } from "execa";
import { DEFAULT_FALLBACK_CHAIN, BACKEND_LABELS } from "../config.js";

// ── Backend definitions ─────────────────────────────────────────────────────
export const BACKENDS = {
  bonsai: {
    probe: ["bonsai", ["--version"]],
    start: (opts) => ["bonsai", ["start"], opts],
    login: ["bonsai", ["login"]],
    logout: ["bonsai", ["logout"]],
    passTask: (task) => ({ env: { QUARK_TASK: task } }),
  },
  claude: {
    probe: ["claude", ["--version"]],
    start: (opts) => ["claude", [], opts],
    login: null,
    logout: null,
    passTask: (task) => ({ args: [task] }),
  },
  gemini: {
    probe: ["gemini", ["--version"]],
    start: (opts) => ["gemini", [], opts],
    login: null,
    logout: null,
    passTask: (task) => ({ env: { GEMINI_TASK: task } }),
  },
  opencode: {
    probe: ["opencode", ["--version"]],
    start: (opts) => ["opencode", [], opts],
    login: null,
    logout: null,
    passTask: (task) => ({ args: [task] }),
  },
  glm: {
    // Z.ai GLM Code CLI — invoked as `glm-code` or `glm`
    probe: ["glm-code", ["--version"]],
    probeFallback: ["glm", ["--version"]],
    start: (opts) => {
      try {
        return ["glm-code", [], opts];
      } catch {
        return ["glm", [], opts];
      }
    },
    login: null,
    logout: null,
    passTask: (task) => ({ env: { GLM_TASK: task } }),
  },
  "quark-agent": {
    internal: true, // handled separately, no CLI probe needed
  },
};

// ── Probe: is a backend CLI installed? ─────────────────────────────────────
export async function isBackendAvailable(key) {
  if (key === "quark-agent") return true; // always available
  const def = BACKENDS[key];
  if (!def) return false;

  const probes = [def.probe, def.probeFallback].filter(Boolean);
  for (const [cmd, args] of probes) {
    try {
      await execa(cmd, args, { stdio: "ignore", timeout: 3000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ── Resolve: walk fallback chain from a starting backend ───────────────────
export async function resolveBackend(preferred, fallbackEnabled = true) {
  const chain = fallbackEnabled
    ? [preferred, ...DEFAULT_FALLBACK_CHAIN.filter((k) => k !== preferred)]
    : [preferred, "quark-agent"];

  for (const key of chain) {
    const available = await isBackendAvailable(key);
    if (available) return { key, label: BACKEND_LABELS[key] };
  }
  // quark-agent is always last resort
  return { key: "quark-agent", label: BACKEND_LABELS["quark-agent"] };
}

// ── Probe all backends (for status) ────────────────────────────────────────
export async function probeAllBackends() {
  const results = {};
  await Promise.all(
    Object.keys(BACKENDS).map(async (key) => {
      results[key] = await isBackendAvailable(key);
    })
  );
  return results;
}
