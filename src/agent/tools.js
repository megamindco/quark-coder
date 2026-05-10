// src/agent/tools.js
// Maps Emergent tool schema → local CLI executors

import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { createInterface } from "readline";

const execAsync = promisify(exec);

// ── Tool Definitions (Anthropic format) ────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "think",
    description: "Think through a problem internally. Use before complex decisions.",
    input_schema: {
      type: "object",
      properties: {
        thought: { type: "string", description: "Your internal reasoning" },
      },
      required: ["thought"],
    },
  },
  {
    name: "execute_bash",
    description: "Execute a bash command in the local terminal. Background long-running tasks with &.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command to execute" },
      },
      required: ["command"],
    },
  },
  {
    name: "mcp_view_file",
    description: "Read a file or list a directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to file/dir" },
        view_range: {
          type: "array",
          items: { type: "integer" },
          description: "Optional [start, end] line range",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "mcp_create_file",
    description: "Create a new file with specified content. Creates parent directories if needed.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path for the new file" },
        file_text: { type: "string", description: "Content for the new file" },
      },
      required: ["path", "file_text"],
    },
  },
  {
    name: "mcp_bulk_file_writer",
    description: "Write multiple files simultaneously. Most efficient for multi-file operations.",
    input_schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      },
      required: ["files"],
    },
  },
  {
    name: "mcp_search_replace",
    description: "Search and replace an exact string in a file. Use for targeted edits.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_str: { type: "string", description: "Exact string to replace — must match exactly" },
        new_str: { type: "string", description: "Replacement string" },
        replace_all: { type: "boolean", default: false },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
  {
    name: "mcp_glob_files",
    description: "Find files matching a glob pattern.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern" },
        path: { type: "string", description: "Directory to search in (optional)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep_tool",
    description: "Search file contents using regex patterns.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern" },
        path: { type: "string", description: "File or directory to search" },
        case_sensitive: { type: "boolean", default: true },
        context_lines: { type: "integer", default: 2 },
        include: { type: "string", description: "File pattern filter, e.g. '*.js'" },
      },
      required: ["pattern", "path"],
    },
  },
  {
    name: "ask_human",
    description: "Ask the developer a question and wait for their response. Use for clarification or confirmation.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Question to ask the developer" },
      },
      required: ["question"],
    },
  },
  {
    name: "finish",
    description: "Signal task completion. Provide a concise summary (max 2 lines).",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Concise summary of what was done" },
      },
      required: ["summary"],
    },
  },
];

// ── Tool Executors ──────────────────────────────────────────────────────────

export async function executeTool(name, input, cwd = process.cwd()) {
  switch (name) {
    case "think": {
      return { type: "thought", content: input.thought };
    }

    case "execute_bash": {
      try {
        const { stdout, stderr } = await execAsync(input.command, {
          cwd,
          timeout: 120_000, // 2 min max
          maxBuffer: 1024 * 1024 * 10,
        });
        return {
          stdout: stdout || "",
          stderr: stderr || "",
          success: true,
        };
      } catch (err) {
        return {
          stdout: err.stdout || "",
          stderr: err.stderr || err.message,
          success: false,
          exitCode: err.code,
        };
      }
    }

    case "mcp_view_file": {
      try {
        const { statSync, readdirSync } = await import("fs");
        const stat = statSync(input.path);
        if (stat.isDirectory()) {
          const entries = readdirSync(input.path, { withFileTypes: true });
          const listing = entries
            .map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`)
            .join("\n");
          return { content: listing, type: "directory" };
        }
        let content = await readFile(input.path, "utf8");
        if (input.view_range) {
          const [start, end] = input.view_range;
          const lines = content.split("\n");
          content = lines.slice(start - 1, end).join("\n");
        }
        return { content, type: "file" };
      } catch (err) {
        return { error: err.message };
      }
    }

    case "mcp_create_file": {
      try {
        await mkdir(dirname(input.path), { recursive: true });
        await writeFile(input.path, input.file_text, "utf8");
        return { success: true, path: input.path };
      } catch (err) {
        return { error: err.message };
      }
    }

    case "mcp_bulk_file_writer": {
      const results = [];
      for (const file of input.files) {
        try {
          await mkdir(dirname(file.path), { recursive: true });
          await writeFile(file.path, file.content, "utf8");
          results.push({ path: file.path, success: true });
        } catch (err) {
          results.push({ path: file.path, success: false, error: err.message });
        }
      }
      return { results };
    }

    case "mcp_search_replace": {
      try {
        let content = await readFile(input.path, "utf8");
        if (!content.includes(input.old_str)) {
          return { error: "old_str not found in file — must match exactly" };
        }
        if (input.replace_all) {
          content = content.split(input.old_str).join(input.new_str);
        } else {
          content = content.replace(input.old_str, input.new_str);
        }
        await writeFile(input.path, content, "utf8");
        return { success: true };
      } catch (err) {
        return { error: err.message };
      }
    }

    case "mcp_glob_files": {
      try {
        const searchDir = input.path || cwd;
        const { stdout } = await execAsync(
          `find ${searchDir} -name "${input.pattern}" 2>/dev/null | head -100`,
          { cwd }
        );
        return { files: stdout.trim().split("\n").filter(Boolean) };
      } catch {
        // fall back to basic glob
        const { glob } = await import("fs/promises");
        const files = await glob(input.pattern, { cwd: input.path || cwd });
        return { files };
      }
    }

    case "grep_tool": {
      try {
        const flags = [
          input.case_sensitive === false ? "-i" : "",
          input.context_lines ? `-C ${input.context_lines}` : "",
          input.include ? `--include="${input.include}"` : "",
          "-r",
        ]
          .filter(Boolean)
          .join(" ");
        const { stdout } = await execAsync(
          `grep ${flags} "${input.pattern}" "${input.path}" 2>/dev/null | head -200`,
          { cwd }
        );
        return { matches: stdout };
      } catch (err) {
        return { matches: "", error: err.message };
      }
    }

    case "ask_human": {
      return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`\n  ${input.question}\n  > `, (answer) => {
          rl.close();
          resolve({ answer });
        });
      });
    }

    case "finish": {
      return { done: true, summary: input.summary };
    }

    default:
      return { error: `Tool '${name}' is not available in local CLI context.` };
  }
}
