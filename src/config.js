// src/config.js
import Conf from "conf";

export const store = new Conf({
  projectName: "quark-mmc",
  schema: {
    activeBackend:    { type: "string",  default: "bonsai" },
    fallbackEnabled:  { type: "boolean", default: true },
    // Agent provider config
    agentProvider:    { type: "string",  default: "anthropic" },
    agentModel:       { type: "string",  default: "" },
    anthropicApiKey:  { type: "string",  default: "" },
    openrouterApiKey: { type: "string",  default: "" },
    glmApiKey:        { type: "string",  default: "" },
    openrouterSiteUrl:{ type: "string",  default: "https://megamindco.com" },
    // Bonsai auth
    bonsaiAuthenticated: { type: "boolean", default: false },
    lastLogin:        { type: "string",  default: "" },
  },
});

export const BACKEND_KEYS  = ["bonsai","claude","gemini","opencode","glm","quark-agent"];
export const BACKEND_LABELS = {
  bonsai:        "Bonsai AI",
  claude:        "Claude Code",
  gemini:        "Gemini CLI",
  opencode:      "OpenCode",
  glm:           "Z.ai GLM Code",
  "quark-agent": "Quark Agent (built-in)",
};
export const DEFAULT_FALLBACK_CHAIN = ["bonsai","claude","gemini","opencode","glm","quark-agent"];

// Backend helpers
export const getActiveBackend  = () => store.get("activeBackend");
export const setActiveBackend  = (k) => store.set("activeBackend", k);
export const isFallbackEnabled = () => store.get("fallbackEnabled");
export const isAuthenticated   = () => store.get("bonsaiAuthenticated") === true;
export const setAuthenticated  = (v) => { store.set("bonsaiAuthenticated", v); if (v) store.set("lastLogin", new Date().toISOString()); };
export const clearAuth         = () => { store.set("bonsaiAuthenticated", false); store.set("lastLogin", ""); };

// Provider helpers
export const getAgentProvider  = () => store.get("agentProvider");
export const setAgentProvider  = (p) => store.set("agentProvider", p);
export const getAgentModel     = () => store.get("agentModel");
export const setAgentModel     = (m) => store.set("agentModel", m);

export function getProviderKey(provider) {
  const envMap = { anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY", glm: "GLM_API_KEY" };
  const storeMap = { anthropic: "anthropicApiKey", openrouter: "openrouterApiKey", glm: "glmApiKey" };
  return process.env[envMap[provider]] || store.get(storeMap[provider]) || "";
}

export function setProviderKey(provider, key) {
  const storeMap = { anthropic: "anthropicApiKey", openrouter: "openrouterApiKey", glm: "glmApiKey" };
  if (storeMap[provider]) store.set(storeMap[provider], key);
}

// Legacy alias (used by old login/agent commands)
export const getAnthropicKey = () => getProviderKey("anthropic");
export const setAnthropicKey = (k) => setProviderKey("anthropic", k);
