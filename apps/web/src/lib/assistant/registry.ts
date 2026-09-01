import 'server-only';
import type { AgentTool } from '@tangible/ai';
import { knowledgeTools } from './knowledge-tools';
import { marketTools } from './market-tools';
import { precedentTools } from './precedent-tools';
import { workspaceTools } from './workspace-tools';
import type { AssistantTool } from './types';

export const ASSISTANT_TOOLS: AssistantTool[] = [
  ...workspaceTools,
  ...precedentTools,
  ...marketTools,
  ...knowledgeTools,
];

const BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

export function findTool(name: string): AssistantTool | null {
  return BY_NAME.get(name) ?? null;
}

/** The registry as the provider needs it: name, description, argument schema. */
export function agentTools(): AgentTool[] {
  return ASSISTANT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.args,
  }));
}
