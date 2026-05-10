// src/commands/use.js
import chalk from "chalk";
import inquirer from "inquirer";
import {
  BACKEND_KEYS, BACKEND_LABELS,
  getActiveBackend, setActiveBackend,
  store,
  getAgentProvider, setAgentProvider,
  getAgentModel, setAgentModel,
  getProviderKey, setProviderKey,
} from "../config.js";
import { isBackendAvailable } from "../backends/index.js";
import { PROVIDERS } from "../agent/providers.js";

const BRAND = "#00CFFF";

export async function useCommand() {
  // ── Step 1: Backend selection ─────────────────────────────────────────
  console.log(chalk.dim("\n  Probing installed CLI backends...\n"));
  const availability = {};
  await Promise.all(BACKEND_KEYS.map(async (k) => { availability[k] = await isBackendAvailable(k); }));

  const current = getActiveBackend();
  const backendChoices = BACKEND_KEYS.map((key) => {
    const ok = availability[key];
    const dot = ok ? chalk.hex(BRAND)("✦") : chalk.dim("○");
    const label = ok ? chalk.white(BACKEND_LABELS[key]) : chalk.dim(BACKEND_LABELS[key]);
    const active = key === current ? chalk.hex(BRAND)(" ← active") : "";
    return {
      name: `${dot} ${label}${active}`,
      value: key,
      disabled: (!ok && key !== "quark-agent") ? "not installed" : false,
    };
  });

  const { selectedBackend } = await inquirer.prompt([{
    type: "list",
    name: "selectedBackend",
    message: "Active coding backend:",
    choices: backendChoices,
    default: current,
  }]);
  setActiveBackend(selectedBackend);

  // ── Step 2: Fallback ──────────────────────────────────────────────────
  const { fallback } = await inquirer.prompt([{
    type: "confirm",
    name: "fallback",
    message: `Auto-fallback chain? ${chalk.dim("(bonsai → claude → gemini → opencode → glm → quark-agent)")}`,
    default: store.get("fallbackEnabled"),
  }]);
  store.set("fallbackEnabled", fallback);

  // ── Step 3: Quark Agent provider ──────────────────────────────────────
  console.log(chalk.dim("\n  Configure Quark Agent provider:\n"));

  const providerChoices = Object.entries(PROVIDERS).map(([key, def]) => {
    const hasKey = !!getProviderKey(key);
    const dot = hasKey ? chalk.hex(BRAND)("✦") : chalk.dim("○");
    const active = key === getAgentProvider() ? chalk.hex(BRAND)(" ← active") : "";
    return {
      name: `${dot} ${def.label}${active} ${hasKey ? chalk.dim("(key set)") : chalk.dim("(no key)")}`,
      value: key,
    };
  });

  const { selectedProvider } = await inquirer.prompt([{
    type: "list",
    name: "selectedProvider",
    message: "Quark Agent LLM provider:",
    choices: providerChoices,
    default: getAgentProvider(),
  }]);
  setAgentProvider(selectedProvider);

  // ── Step 4: API key for selected provider ─────────────────────────────
  const providerDef = PROVIDERS[selectedProvider];
  const existingKey = getProviderKey(selectedProvider);

  if (!existingKey) {
    const { apiKey } = await inquirer.prompt([{
      type: "password",
      name: "apiKey",
      message: `${providerDef.keyName}:`,
      validate: (v) => v.trim().length > 10 || "Key required",
    }]);
    setProviderKey(selectedProvider, apiKey.trim());
    console.log(chalk.dim("  Key saved."));
  } else {
    const { updateKey } = await inquirer.prompt([{
      type: "confirm",
      name: "updateKey",
      message: `Key already set (…${existingKey.slice(-6)}). Update it?`,
      default: false,
    }]);
    if (updateKey) {
      const { apiKey } = await inquirer.prompt([{
        type: "password",
        name: "apiKey",
        message: `New ${providerDef.keyName}:`,
        validate: (v) => v.trim().length > 10 || "Key required",
      }]);
      setProviderKey(selectedProvider, apiKey.trim());
      console.log(chalk.dim("  Key updated."));
    }
  }

  // ── Step 5: Model selection ───────────────────────────────────────────
  const modelChoices = [
    ...providerDef.models.map((m) => ({ name: m, value: m })),
    { name: chalk.dim("Custom (enter manually)"), value: "__custom__" },
  ];

  const currentModel = getAgentModel() || providerDef.defaultModel;
  const { selectedModel } = await inquirer.prompt([{
    type: "list",
    name: "selectedModel",
    message: "Model:",
    choices: modelChoices,
    default: currentModel,
  }]);

  if (selectedModel === "__custom__") {
    const { customModel } = await inquirer.prompt([{
      type: "input",
      name: "customModel",
      message: "Enter model name:",
      validate: (v) => v.trim().length > 0 || "Required",
    }]);
    setAgentModel(customModel.trim());
  } else {
    setAgentModel(selectedModel);
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.hex(BRAND)("✦ Configuration saved"));
  console.log(chalk.dim("  Backend:  ") + chalk.white(BACKEND_LABELS[selectedBackend]));
  console.log(chalk.dim("  Provider: ") + chalk.white(providerDef.label));
  console.log(chalk.dim("  Model:    ") + chalk.white(getAgentModel()));
  console.log(chalk.dim("  Fallback: ") + chalk.white(fallback ? "enabled" : "disabled"));
  console.log();
}
