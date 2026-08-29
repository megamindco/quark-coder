# DASA Architecture Overview

DASA stands for **Dynamic Adaptive Self-Aware Agents**. It is an advanced multi-agent orchestration pipeline implemented in the Quark coding CLI (specifically as the "Super Quark Agent").

The pipeline dynamically assembles a team of specialized agents to solve a complex coding task, evaluates their outputs using a two-phase watchdog system, and continuously learns by updating agent performance scores in a persistent pool.

## The Pipeline Phases

The DASA pipeline consists of the following 5 main components running sequentially (or parallel in the execution phase):

### 1. Generator
- **Role:** Task Decomposition and Team Assembly
- **Process:** It takes the initial user task, queries the **Agent Pool** for available agent roles and their capabilities, and uses an LLM to generate a **Spawn Manifest**.
- **Spawn Manifest:** A structured JSON document that defines:
  - Which agents to summon from the pool (e.g., Planner, Backend Specialist, Tester).
  - The specific task slice for each agent.
  - The execution order and phases (which agents run sequentially and which run in parallel).
  - Dependencies and context hints.

### 2. Executor
- **Role:** Individual Sub-agent Execution
- **Process:** Each agent defined in the Spawn Manifest is instantiated with a tailored system prompt that includes its specific task slice, instructions from its role in the pool, and prior agents' outputs as context.
- **Tools:** The agents execute in a loop (up to 20-25 turns) using tools (e.g., bash execution, file read/write, search and replace) to write actual code or perform their designated tasks.

### 3. Watchdog Phase 1 (Per-Agent Validation)
- **Role:** Quality Gate for Individual Agents
- **Process:** Once an agent completes its task slice, its output is evaluated against thresholds defined in the manifest.
- **Checks Include:**
  - Minimum output length.
  - Absence of stubs or placeholder code (e.g., `// TODO`).
  - Presence of required artifacts and quality signals (e.g., tests having assertions, backend having routes).
- **Outcome:** If an agent fails Phase 1, it is **respawned** (re-run) with context about why it failed, allowing it to correct its output (up to a maximum number of respawns, typically 2).

### 4. Watchdog Phase 2 (Compound Coherence)
- **Role:** Quality Gate for the Entire Team
- **Process:** After all execution phases complete, Phase 2 uses an LLM (or a heuristic fallback) to evaluate the **compound output** of all agents combined.
- **Checks Include:**
  - **Interface Coherence:** Do the agents' outputs fit together?
  - **No Contradiction:** Are there conflicting assumptions between agents?
  - **Integration Ready:** Can the code be assembled without conflicts?
  - **Task Coverage:** Does the combined work address the original user task?
- **Outcome:** Produces a final pass/fail score (Approved or Rejected/Conditional) and a summary of issues.

### 5. Agent Pool Write-back (Continuous Learning)
- **Role:** Institutional Memory and Persistent Capability Registry
- **Process:** The system updates the persistent **Agent Pool** (stored locally or globally on disk).
- **Updates Include:**
  - Adjusting each agent's **performance score** (average Watchdog score) based on how well they did in the current session.
  - Appending session learnings to an agent's `system_prompt_delta` if issues were found or new insights were gained.
  - Saving the session manifest and a learning summary for future reference.

This architecture ensures high-quality, coherent code generation by distributing work efficiently, strictly validating the results, and continuously improving agent behaviors over time based on actual performance.
