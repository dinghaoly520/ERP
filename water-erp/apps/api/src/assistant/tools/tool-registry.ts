import { Injectable } from '@nestjs/common';
import { AssistantTool } from './assistant-tool';

@Injectable()
export class ToolRegistry {
  private tools = new Map<string, AssistantTool>();

  register(tool: AssistantTool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AssistantTool | undefined {
    return this.tools.get(name);
  }

  list(): Array<{ name: string; description: string }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }
}
