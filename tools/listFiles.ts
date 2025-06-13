import * as fs from "node:fs/promises";
import * as path from "node:path";

import { ToolDefinition } from "./toolDefinition";

interface ListFilesInput {
  path?: string;
}

const ListFilesInputSchema = {
  type: "object" as const,
  properties: {
    path: {
      type: "string" as const,
      description:
        "Optional relative path to list files from. Defaults to current directory if not provided.",
    },
  },
};

async function walkDirectory(
  dir: string,
  baseDir: string = dir
): Promise<string[]> {
  const files: string[] = [];

  if (dir === "node_modules" || dir === ".git") {
    return files;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        files.push(relativePath + "/");
        const subFiles = await walkDirectory(fullPath, baseDir);
        files.push(...subFiles);
      } else {
        files.push(relativePath);
      }
    }
  } catch (error) {
    throw new Error(`Failed to read directory: ${error}`);
  }

  return files;
}

async function ListFiles(input: ListFilesInput): Promise<string> {
  const dir = input.path || ".";

  try {
    const files = await walkDirectory(dir);
    return JSON.stringify(files);
  } catch (error) {
    throw new Error(`Failed to list files: ${error}`);
  }
}

export const ListFilesDefinition: ToolDefinition = {
  name: "list_files",
  description:
    "List files and directories at a given path. If no path is provided, lists files in the current directory.",
  input_schema: ListFilesInputSchema,
  function: ListFiles,
};
