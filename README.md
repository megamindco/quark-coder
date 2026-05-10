# Quark ⬡

**MMC's unified AI coding CLI.**  
One command. Six backends. Built-in agent. Always falls back.

---

## What it does

Quark wraps any frontier AI coding tool behind a single `quark` interface. If your primary backend isn't installed or fails, Quark automatically tries the next one in the chain — ending with the built-in **Quark Agent** which always works.

```
Fallback chain:
bonsai → claude → gemini → opencode → glm → quark-agent
```

---

## Install

```bash
# From repo root
npm install
npm link        # makes `quark` available globally
```

---

## Backends

| Key | Tool | Install |
|-----|------|---------|
| `bonsai` | Bonsai AI | `npm install -g @bonsai-ai/cli` |
| `claude` | Claude Code | `npm install -g @anthropic-ai/claude-code` |
| `gemini` | Gemini CLI | `npm install -g @google/gemini-cli` |
| `opencode` | OpenCode | `npm install -g opencode-ai` |
| `glm` | Z.ai GLM Code | `npm install -g glm-code` |
| `quark-agent` | Quark Agent | Built-in — needs `ANTHROPIC_API_KEY` |

You don't need all of them. Install what you use. Quark figures out the rest.

---

## Commands

### `quark use`
Interactive backend selector. Pick your primary backend, configure fallback, and set API keys.

```bash
quark use
```

### `quark start`
Start an AI coding session with the active backend. Auto-falls back if unavailable.

```bash
quark start
quark start --dir ./my-project
```

### `quark run "<task>"`
One-shot task. Passes the task to the active backend.

```bash
quark run "refactor the auth module"
quark run "add dark mode toggle" --dir ./frontend
```

### `quark agent [task]`
Run **Quark Agent** directly — the built-in E1-style agentic coding assistant.  
Powered by Claude via Anthropic API. Uses local tools: bash, file read/write, search/replace, glob, grep.

```bash
quark agent
quark agent "build a REST API with FastAPI and MongoDB"
quark agent "add pagination to the users table" --dir ./backend
quark agent --model claude-opus-4-5
```

**Quark Agent tools available:**
- `execute_bash` — run any shell command
- `mcp_create_file` — create files with content
- `mcp_bulk_file_writer` — write multiple files at once
- `mcp_view_file` — read files or list directories
- `mcp_search_replace` — targeted find-and-replace in files
- `mcp_glob_files` — find files by pattern
- `grep_tool` — search file contents by regex
- `ask_human` — ask you a question mid-task
- `think` — internal reasoning (shown as dim output)
- `finish` — signals task complete with summary

### `quark login`
Authenticate with the active backend (runs `bonsai login` etc.).

```bash
quark login
```

### `quark logout`
Sign out and clear session.

```bash
quark logout
```

### `quark status`
Show all backend availability, active backend, API key config, and fallback state.

```bash
quark status
```

---

## Configuration

Config stored at: `~/.config/quark-mmc/config.json`

| Key | Default | Description |
|-----|---------|-------------|
| `activeBackend` | `bonsai` | Primary backend |
| `fallbackEnabled` | `true` | Auto-fallback to next available |
| `anthropicApiKey` | `""` | For Quark Agent (or use env var) |
| `agentModel` | `claude-opus-4-5` | Model for Quark Agent |

You can also set `ANTHROPIC_API_KEY` as an environment variable — it takes priority over stored config.

---

## Quark Agent — how it works

Quark Agent is an agentic loop powered by Claude. It:

1. Takes your task description
2. Thinks through an approach (visible as dim `◈` lines)
3. Executes tools autonomously — bash, file writes, searches
4. Asks you (`ask_human`) when it needs clarification
5. Calls `finish` when done, with a 2-line summary

It follows the **E1 workflow** adapted for local development:
- Frontend-first with mock data
- Backend integration after validation  
- No dead UI — all buttons work
- Clean, modern code with proper error handling

Max turns: 40 (prevents runaway loops).

---

## Examples

```bash
# Switch to Claude Code as primary backend
quark use        # select "Claude Code" interactively

# Start a session in a specific project
quark start --dir ~/projects/tensora-api

# One-shot: add a feature
quark run "implement JWT refresh token rotation" --dir ./backend

# Use the built-in agent to scaffold a new project
quark agent "create a React + FastAPI app with user auth and MongoDB"

# Check what's available on this machine
quark status
```

---

*Quark — MMC Coding Infrastructure*  
*Internal tool. Three-person team.*
