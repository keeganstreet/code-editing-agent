import * as fs from "node:fs/promises";

import { ToolDefinition } from "./toolDefinition";

interface ReadFileInput {
  path: string;
}

const ReadFileInputSchema = {
  type: "object" as const,
  properties: {
    path: {
      type: "string" as const,
      description: "The relative path of a file in the working directory.",
    },
  },
  required: ["path"],
};

async function ReadFile(input: ReadFileInput): Promise<string> {
  try {
    const content = await fs.readFile(input.path, "utf-8");
    return content;
  } catch (error) {
    throw new Error(`Failed to read file: ${error}`);
  }
}

export const ReadFileDefinition: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a given relative file path. Use this when you want to see what's inside a file. Do not use this with directory names.",
  input_schema: ReadFileInputSchema,
  function: ReadFile,
};
