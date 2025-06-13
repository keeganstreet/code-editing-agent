import * as fs from "node:fs/promises";
import * as path from "node:path";

import { ToolDefinition } from "./toolDefinition";

interface EditFileInput {
  path: string;
  old_str: string;
  new_str: string;
}

const EditFileInputSchema = {
  type: "object" as const,
  properties: {
    path: {
      type: "string" as const,
      description: "The path to the file",
    },
    old_str: {
      type: "string" as const,
      description:
        "Text to search for - must match exactly and must only have one match exactly",
    },
    new_str: {
      type: "string" as const,
      description: "Text to replace old_str with",
    },
  },
  required: ["path", "old_str", "new_str"],
};

async function createNewFile(
  filePath: string,
  content: string
): Promise<string> {
  const dir = path.dirname(filePath);
  if (dir !== ".") {
    await fs.mkdir(dir, { recursive: true });
  }

  await fs.writeFile(filePath, content, "utf-8");
  return `Successfully created file ${filePath}`;
}

async function EditFile(input: EditFileInput): Promise<string> {
  if (!input.path || input.old_str === input.new_str) {
    throw new Error("Invalid input parameters");
  }

  try {
    const content = await fs.readFile(input.path, "utf-8");
    const newContent = content.replace(input.old_str, input.new_str);

    if (content === newContent && input.old_str !== "") {
      throw new Error("old_str not found in file");
    }

    await fs.writeFile(input.path, newContent, "utf-8");
    return "OK";
  } catch (error: any) {
    if (error.code === "ENOENT" && input.old_str === "") {
      return await createNewFile(input.path, input.new_str);
    }
    throw error;
  }
}

export const EditFileDefinition: ToolDefinition = {
  name: "edit_file",
  description: `Make edits to a text file.

Replaces 'old_str' with 'new_str' in the given file. 'old_str' and 'new_str' MUST be different from each other.

If the file specified with path doesn't exist, it will be created.`,
  input_schema: EditFileInputSchema,
  function: EditFile,
};
