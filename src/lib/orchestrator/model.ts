import { z } from "zod";
import type { SpecialistKey } from "../domain/roles";

export interface AgentTool<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  execute: (input: I) => Promise<unknown>;
}

export interface SpecialistCall {
  role: SpecialistKey;
  system: string;
  prompt: string;
  tools: AgentTool[];
  submitToolName: string;
  maxSteps: number;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface SpecialistResult {
  /** input passed to the submit tool, or null when the model never submitted */
  submitted: unknown;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  costBasis: "actual" | "estimated" | "unknown";
  model: string;
  steps: number;
}

export interface ModelClient {
  readonly live: boolean;
  readonly modelId: string;
  runSpecialist(call: SpecialistCall): Promise<SpecialistResult>;
}

export class TransientModelError extends Error {
  readonly transient = true;
}

export function isTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { transient?: boolean; isRetryable?: boolean; statusCode?: number; code?: string; name?: string };
  if (e.name === "AbortError") return false;
  if (e.transient === true || e.isRetryable === true) return true;
  if (typeof e.statusCode === "number" && (e.statusCode === 429 || e.statusCode >= 500)) return true;
  return e.code === "ETIMEDOUT" || e.code === "ECONNRESET";
}

// ---------------------------------------------------------------------------
// Live client: Vercel AI Gateway through the AI SDK. Model ids are configuration.
// ---------------------------------------------------------------------------
export class GatewayModelClient implements ModelClient {
  readonly live = true;
  constructor(
    readonly modelId: string,
    private readonly pricing: { inputPerMTok: number; outputPerMTok: number } | null = null,
  ) {}

  async runSpecialist(call: SpecialistCall): Promise<SpecialistResult> {
    const { generateText, tool, isStepCount, hasToolCall } = await import("ai");
    let submitted: unknown = null;
    const tools: Record<string, any> = {};
    for (const t of call.tools) {
      tools[t.name] = tool({
        description: t.description,
        inputSchema: t.inputSchema as any,
        execute: async (input: unknown) => {
          const out = await t.execute(input);
          if (t.name === call.submitToolName) submitted = input;
          return out;
        },
      } as any);
    }
    const result: any = await generateText({
      model: this.modelId,
      system: call.system,
      prompt: call.prompt,
      tools,
      stopWhen: [isStepCount(call.maxSteps), hasToolCall(call.submitToolName)],
      maxOutputTokens: call.maxOutputTokens,
      abortSignal: call.signal,
      maxRetries: 0, // retries are owned by the orchestrator
    } as any);
    const usage = result.usage ?? result.totalUsage ?? {};
    const inputTokens = Number(usage.inputTokens ?? 0);
    const outputTokens = Number(usage.outputTokens ?? 0);
    const gatewayCost = Number(result.providerMetadata?.gateway?.cost ?? NaN);
    let costUsd: number | null = null;
    let costBasis: SpecialistResult["costBasis"] = "unknown";
    if (Number.isFinite(gatewayCost)) {
      costUsd = gatewayCost;
      costBasis = "actual";
    } else if (this.pricing) {
      costUsd = (inputTokens * this.pricing.inputPerMTok + outputTokens * this.pricing.outputPerMTok) / 1_000_000;
      costBasis = "estimated";
    }
    return {
      submitted,
      inputTokens,
      outputTokens,
      costUsd,
      costBasis,
      model: this.modelId,
      steps: Array.isArray(result.steps) ? result.steps.length : 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture client: deterministic, clearly non-live. Used by tests and demo mode only.
// ---------------------------------------------------------------------------
export type FixtureScript = (
  call: SpecialistCall,
  helpers: { callTool: (name: string, input: unknown) => Promise<unknown>; attempt: number },
) => Promise<unknown> | unknown;

export class FixtureModelClient implements ModelClient {
  readonly live = false;
  readonly modelId = "fixture/deterministic";
  attempts = new Map<string, number>();
  calls: SpecialistKey[] = [];
  constructor(private readonly scripts: Partial<Record<SpecialistKey, FixtureScript>>, private readonly tokensPerCall = 1000) {}

  async runSpecialist(call: SpecialistCall): Promise<SpecialistResult> {
    this.calls.push(call.role);
    const attempt = (this.attempts.get(call.role) ?? 0) + 1;
    this.attempts.set(call.role, attempt);
    const script = this.scripts[call.role];
    if (!script) throw new Error(`no fixture script for ${call.role}`);
    let steps = 0;
    const callTool = async (name: string, input: unknown) => {
      if (call.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      if (++steps > call.maxSteps) throw new Error("step limit reached");
      const t = call.tools.find((x) => x.name === name);
      if (!t) throw new Error(`tool ${name} is not available to ${call.role}`);
      return t.execute(t.inputSchema.parse(input));
    };
    const output = await script(call, { callTool, attempt });
    const submit = call.tools.find((t) => t.name === call.submitToolName)!;
    await submit.execute(output);
    return {
      submitted: output,
      inputTokens: this.tokensPerCall,
      outputTokens: Math.round(this.tokensPerCall / 4),
      costUsd: null,
      costBasis: "unknown",
      model: this.modelId,
      steps: steps + 1,
    };
  }
}
