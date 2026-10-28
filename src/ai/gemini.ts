// Server-side text generation through the Gemini API (DECISIONS D17). This is
// the Node equivalent of the google-genai quickstart:
//
//   client = genai.Client(); client.models.generate_content(model=..., contents=...)
//
// Rules: the API key comes from the server environment only (never the DB,
// Git, logs or clients); the call is read-only toward Google; nothing here
// computes money or counts. Callers pass figures RevOS already computed and
// receive plain text that clients label as AI-generated.

import { ApiError, BlockedReason, FinishReason, GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
export const GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
export const GEMINI_MODEL_ENV = "GEMINI_MODEL";

export type AiErrorKind = "not_configured" | "blocked" | "empty" | "truncated" | "auth" | "rate_limited" | "timeout" | "network" | "upstream";

export class AiError extends Error {
  constructor(readonly kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
  }
}

export interface TextRequest {
  /** Standing instructions (system prompt). */
  system: string;
  /** The user turn: figures plus the task. */
  prompt: string;
  maxOutputTokens?: number;
}

export interface TextResult {
  text: string;
  /** The model version the provider reports, or the requested model. */
  model: string;
}

export interface TextGenerator {
  readonly provider: "gemini";
  readonly model: string;
  generate(req: TextRequest): Promise<TextResult>;
}

/** The slice of the SDK client we use, so tests can inject a fake without network. */
export interface GeminiClientLike {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** Per-request timeout in milliseconds. Default 20 s. */
  timeoutMs?: number;
  /** Injected client (tests). Default: the official SDK with the given key. */
  client?: GeminiClientLike;
}

export class GeminiTextGenerator implements TextGenerator {
  readonly provider = "gemini" as const;
  readonly model: string;
  private readonly client: GeminiClientLike;

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey) throw new AiError("not_configured", `${GEMINI_API_KEY_ENV} is not set.`);
    this.model = opts.model ?? DEFAULT_GEMINI_MODEL;
    // One attempt per user request: no automatic retry loops (spend containment, D17).
    this.client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey, httpOptions: { timeout: opts.timeoutMs ?? 20_000, retryOptions: { attempts: 1 } } });
  }

  async generate(req: TextRequest): Promise<TextResult> {
    let res: GenerateContentResponse;
    try {
      res = await this.client.models.generateContent({
        model: this.model,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          temperature: 0.2,
          maxOutputTokens: req.maxOutputTokens ?? 400,
          candidateCount: 1,
        },
      });
    } catch (err) {
      throw toAiError(err);
    }
    const block = res.promptFeedback?.blockReason;
    if (block && block !== BlockedReason.BLOCKED_REASON_UNSPECIFIED) {
      throw new AiError("blocked", `The provider declined to answer (${block}).`);
    }
    const text = (res.text ?? "").trim();
    const finish = res.candidates?.[0]?.finishReason;
    if (!text) {
      if (finish === FinishReason.MAX_TOKENS) throw new AiError("truncated", "The provider's answer was cut off before any text was returned.");
      if (finish === FinishReason.SAFETY || finish === FinishReason.RECITATION) throw new AiError("blocked", `The provider declined to answer (${finish}).`);
      throw new AiError("empty", "The provider returned no text.");
    }
    return { text, model: res.modelVersion ?? this.model };
  }
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof ApiError) {
    const s = err.status;
    // The Gemini API answers an invalid key with 400 ("API key not valid"), not 401.
    if (s === 401 || s === 403 || (s === 400 && /api key/i.test(err.message))) return new AiError("auth", `The Gemini API rejected the credential (HTTP ${s}).`);
    if (s === 429) return new AiError("rate_limited", "The Gemini API rate limit was hit. Try again in a minute.");
    if (s >= 500) return new AiError("upstream", `The Gemini API failed (HTTP ${s}).`);
    return new AiError("upstream", `The Gemini API rejected the request (HTTP ${s}).`);
  }
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || name === "TimeoutError" || /timed? ?out/i.test(msg)) return new AiError("timeout", "The Gemini API did not answer in time.");
  return new AiError("network", `Could not reach the Gemini API: ${msg}`);
}

/** What a user should do about an AI error (no secrets, no vendor payloads). */
export function aiActionFor(kind: AiErrorKind): string {
  switch (kind) {
    case "not_configured": return `Set ${GEMINI_API_KEY_ENV} in the server environment to enable AI summaries.`;
    case "auth": return `Check the ${GEMINI_API_KEY_ENV} value in the server environment.`;
    case "rate_limited": return "Wait a minute and try again.";
    case "timeout": case "network": case "upstream": return "Try again later. The figures on this page are unaffected.";
    case "blocked": case "empty": case "truncated": return "Try again. If it keeps happening, report it with the show name.";
  }
}

/**
 * Build the generator from the server environment. Returns null when the key
 * is absent, which clients see as "AI summaries not configured". The key value
 * is read once here and never echoed anywhere.
 */
export function createTextGeneratorFromEnv(env: NodeJS.ProcessEnv = process.env): TextGenerator | null {
  const apiKey = env[GEMINI_API_KEY_ENV]?.trim();
  if (!apiKey) return null;
  return new GeminiTextGenerator({ apiKey, model: env[GEMINI_MODEL_ENV]?.trim() || DEFAULT_GEMINI_MODEL });
}
