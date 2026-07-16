import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/modules/shared/env";

// CDC-01 §8.1 — appel Claude.
// Interdits explicites : prompt caching, Batch API (cache expire en 5 min/1 h ;
// les appels sont espacés de plusieurs jours → zéro hit ; Batch = 24 h de
// latence, incompatible avec le créneau).

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
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY manquant : configurer la variable d'environnement.");
    }
    this.sdk = new Anthropic({ apiKey: key });
  }

  async call(input: CallClaudeInput): Promise<CallClaudeResult> {
    const model = input.model ?? env().ANTHROPIC_MODEL;
    const res = await this.sdk.messages.create({
      model,
      max_tokens: input.maxTokens ?? 2000,
      temperature: input.temperature ?? 1.0,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    // On concatène tous les blocs texte de la réponse. Pas d'usage de tool use.
    const text = res.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    return { text, model: res.model };
  }
}

let cached: AnthropicClient | null = null;
export function getAnthropicClient(): AnthropicClient {
  if (!cached) cached = new RealAnthropicClient();
  return cached;
}
