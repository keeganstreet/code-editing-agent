import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import Anthropic from "@anthropic-ai/sdk";

// Type definitions
interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
  function: (input: any) => Promise<string>;
}

// Read File Tool
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

const ReadFileDefinition: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a given relative file path. Use this when you want to see what's inside a file. Do not use this with directory names.",
  input_schema: ReadFileInputSchema,
  function: ReadFile,
};

// List Files Tool
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

const ListFilesDefinition: ToolDefinition = {
  name: "list_files",
  description:
    "List files and directories at a given path. If no path is provided, lists files in the current directory.",
  input_schema: ListFilesInputSchema,
  function: ListFiles,
};

// Edit File Tool
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

const EditFileDefinition: ToolDefinition = {
  name: "edit_file",
  description: `Make edits to a text file.

Replaces 'old_str' with 'new_str' in the given file. 'old_str' and 'new_str' MUST be different from each other.

If the file specified with path doesn't exist, it will be created.`,
  input_schema: EditFileInputSchema,
  function: EditFile,
};

// Agent class
class Agent {
  private client: Anthropic;
  private getUserMessage: () => Promise<string | null>;
  private tools: ToolDefinition[];

  constructor(
    client: Anthropic,
    getUserMessage: () => Promise<string | null>,
    tools: ToolDefinition[]
  ) {
    this.client = client;
    this.getUserMessage = getUserMessage;
    this.tools = tools;
  }

  async run(): Promise<void> {
    const conversation: Anthropic.MessageParam[] = [];

    console.log("Chat with Claude (use 'ctrl-c' to quit)");

    let readUserInput = true;

    while (true) {
      if (readUserInput) {
        process.stdout.write("\u001b[94mYou\u001b[0m: ");
        const userInput = await this.getUserMessage();
        if (userInput === null) {
          break;
        }

        const userMessage: Anthropic.MessageParam = {
          role: "user",
          content: userInput,
        };
        conversation.push(userMessage);
      }

      const message = await this.runInference(conversation);
      conversation.push({
        role: "assistant",
        content: message.content,
      });

      const toolResults: Anthropic.MessageParam["content"] = [];

      for (const content of message.content) {
        if (content.type === "text") {
          console.log(`\u001b[93mClaude\u001b[0m: ${content.text}`);
        } else if (content.type === "tool_use") {
          const result = await this.executeTool(
            content.id,
            content.name,
            content.input
          );
          toolResults.push(result);
        }
      }

      if (toolResults.length === 0) {
        readUserInput = true;
        continue;
      }

      readUserInput = false;
      conversation.push({
        role: "user",
        content: toolResults,
      });
    }
  }

  private async executeTool(
    id: string,
    name: string,
    input: any
  ): Promise<Anthropic.ToolResultBlockParam> {
    const toolDef = this.tools.find((tool) => tool.name === name);

    if (!toolDef) {
      return {
        type: "tool_result",
        tool_use_id: id,
        content: "tool not found",
        is_error: true,
      };
    }

    console.log(`\u001b[92mtool\u001b[0m: ${name}(${JSON.stringify(input)})`);

    try {
      const response = await toolDef.function(input);
      return {
        type: "tool_result",
        tool_use_id: id,
        content: response,
        is_error: false,
      };
    } catch (error: any) {
      return {
        type: "tool_result",
        tool_use_id: id,
        content: error.message,
        is_error: true,
      };
    }
  }

  private async runInference(
    conversation: Anthropic.MessageParam[]
  ): Promise<Anthropic.Message> {
    const anthropicTools: Anthropic.Tool[] = this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: conversation,
      tools: anthropicTools,
    });

    return message;
  }
}

// Main function
async function main(): Promise<void> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const getUserMessage = (): Promise<string | null> => {
    return new Promise((resolve) => {
      rl.question("", (answer) => {
        if (answer === null || answer === undefined) {
          resolve(null);
        } else {
          resolve(answer);
        }
      });
    });
  };

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    rl.close();
    process.exit(0);
  });

  const tools = [ReadFileDefinition, ListFilesDefinition, EditFileDefinition];
  const agent = new Agent(client, getUserMessage, tools);

  try {
    await agent.run();
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  } finally {
    rl.close();
  }
}

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}
