import { listen, isTauriRuntime } from "@/lib/tauri";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface ExplanationChunkPayload {
  skill_id?: string;
  skillId?: string;
  chunk?: string;
  text?: string;
}

export interface ExplanationCompletePayload {
  skill_id?: string;
  skillId?: string;
  explanation?: string;
  error?: string;
}

export interface ExplanationErrorInfo {
  message: string;
  details: string;
  kind: "proxy" | "connect" | "timeout" | "dns" | "tls" | "auth" | "response" | "unknown";
  retryable: boolean;
  fallbackTried: boolean;
}

export interface ExplanationErrorPayload {
  skill_id?: string;
  skillId?: string;
  error?: string;
  error_info?: ExplanationErrorInfo;
}

interface ExplanationStreamHandlers {
  onChunk: (chunk: string) => void;
  onComplete: (payload: ExplanationCompletePayload) => void;
  onError: (payload: ExplanationErrorPayload) => void;
}

export function payloadSkillId(
  payload: ExplanationChunkPayload | ExplanationCompletePayload | ExplanationErrorPayload
) {
  return payload.skill_id ?? payload.skillId ?? null;
}

export function payloadChunkText(payload: ExplanationChunkPayload) {
  return payload.chunk ?? payload.text ?? "";
}

export async function setupExplanationStreamListeners(
  skillId: string,
  handlers: ExplanationStreamHandlers
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const unlisteners: UnlistenFn[] = [];

  const unlistenChunk = await listen<ExplanationChunkPayload>("skill:explanation:chunk", (event) => {
    if (payloadSkillId(event.payload) !== skillId) return;
    const chunkText = payloadChunkText(event.payload);
    if (!chunkText) return;
    handlers.onChunk(chunkText);
  });
  unlisteners.push(unlistenChunk);

  const unlistenComplete = await listen<ExplanationCompletePayload>("skill:explanation:complete", (event) => {
    if (payloadSkillId(event.payload) !== skillId) return;
    handlers.onComplete(event.payload);
  });
  unlisteners.push(unlistenComplete);

  const unlistenError = await listen<ExplanationErrorPayload>("skill:explanation:error", (event) => {
    if (payloadSkillId(event.payload) !== skillId) return;
    handlers.onError(event.payload);
  });
  unlisteners.push(unlistenError);

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
