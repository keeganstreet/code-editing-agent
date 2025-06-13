import Anthropic from "@anthropic-ai/sdk";
import * as readline from "node:readline";

import { ReadFileDefinition } from "./tools/readFile";
import { ToolDefinition } from "./tools/toolDefinition";
import { ListFilesDefinition } from "./tools/listFiles";
import { EditFileDefinition } from "./tools/editFile";

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

    console.log("runInference", JSON.stringify(conversation, null, 2));

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
