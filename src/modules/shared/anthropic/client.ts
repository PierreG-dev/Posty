import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/modules/shared/env";

// Client Anthropic partagé (shared/) — utilisable par tous les modules. Le
// module linkedin garde temporairement le sien (linkedin/ai/anthropic-client)
// par continuité ; à unifier lors d'un futur refactor.

export interface CallClaudeInput {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CallClaudeResult {
  text: string;
  model: string;
}

export interface AnthropicClient {
  call(input: CallClaudeInput): Promise<CallClaudeResult>;
}

export class RealAnthropicClient implements AnthropicClient {
  private sdk: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey ?? env().ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY manquant");
    this.sdk = new Anthropic({ apiKey: key });
  }

  async call(input: CallClaudeInput): Promise<CallClaudeResult> {
    const model = input.model ?? env().ANTHROPIC_MODEL;
    const res = await this.sdk.messages.create({
      model,
      max_tokens: input.maxTokens ?? 1000,
      temperature: input.temperature ?? 1.0,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    const text = res.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    return { text, model: res.model };
  }
}

let cached: AnthropicClient | null = null;
export function getSharedAnthropicClient(): AnthropicClient {
  if (!cached) cached = new RealAnthropicClient();
  return cached;
}
