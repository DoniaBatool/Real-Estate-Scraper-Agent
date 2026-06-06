import axios from "axios";
import type {
  ChatThread,
  ChatMessage,
  ChatToolRun,
  ChatResponse,
} from "@/types";

/** FastAPI backend URL — browser calls it directly (CORS is configured). */
export const API_BASE_URL =
  (typeof process.env.NEXT_PUBLIC_API_URL === "string" && process.env.NEXT_PUBLIC_API_URL.trim()) ||
  "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 360_000,        // 6 minutes — complex multi-page scrapes can take 3-4 min
});

// ─── Chat Threads ─────────────────────────────────────────────────────────────

export async function listChatThreads(): Promise<ChatThread[]> {
  const { data } = await api.get<ChatThread[]>("/api/chat/threads");
  return data;
}

export async function createChatThread(title?: string): Promise<ChatThread> {
  const { data } = await api.post<ChatThread>("/api/chat/threads", { title });
  return data;
}

export async function updateChatThread(
  threadId: string,
  payload: { title?: string; archived?: boolean },
): Promise<ChatThread> {
  const { data } = await api.patch<ChatThread>(`/api/chat/threads/${threadId}`, payload);
  return data;
}

export async function deleteChatThread(threadId: string): Promise<void> {
  await api.delete(`/api/chat/threads/${threadId}`);
}

export async function clearAllChatThreads(): Promise<{ deleted_count: number }> {
  const { data } = await api.delete<{ deleted_count: number }>("/api/chat/threads");
  return data;
}

// ─── Chat Messages ────────────────────────────────────────────────────────────

export async function listChatMessages(threadId: string): Promise<ChatMessage[]> {
  const { data } = await api.get<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`);
  return data;
}

export async function deleteChatMessage(messageId: string): Promise<void> {
  await api.delete(`/api/chat/messages/${messageId}`);
}

export async function sendThreadMessage(
  threadId: string,
  message: string,
  user_fingerprint?: string,
  meta?: Record<string, unknown>,
): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>(`/api/chat/threads/${threadId}/messages`, {
    message,
    user_fingerprint,
    ...(meta ? { meta } : {}),
  });
  return data;
}

// ─── Tool Runs ────────────────────────────────────────────────────────────────

export async function listThreadToolRuns(threadId: string): Promise<ChatToolRun[]> {
  const { data } = await api.get<ChatToolRun[]>(`/api/chat/threads/${threadId}/tool-runs`);
  return data;
}

// ─── Voice Orb helper ─────────────────────────────────────────────────────────

const VOICE_THREAD_STORAGE_KEY = "aria_voice_thread_id";

/** Stateless-style call for the voice orb: reuses a dedicated thread stored in localStorage. */
export async function chatWithAgent(
  message: string,
  _sessionId: string,
  _history: unknown[] = [],
  user_fingerprint?: string,
): Promise<ChatResponse> {
  if (typeof window === "undefined") {
    throw new Error("chatWithAgent is only available in the browser");
  }
  let threadId = localStorage.getItem(VOICE_THREAD_STORAGE_KEY);
  if (!threadId) {
    const thread = await createChatThread("ARIA Voice");
    threadId = thread.id;
    localStorage.setItem(VOICE_THREAD_STORAGE_KEY, threadId);
  }

  try {
    return await sendThreadMessage(threadId, message, user_fingerprint);
  } catch (e: unknown) {
    // Stale ID after DB reset or another device — recreate once.
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      localStorage.removeItem(VOICE_THREAD_STORAGE_KEY);
      const thread = await createChatThread("ARIA Voice");
      const newId = thread.id;
      localStorage.setItem(VOICE_THREAD_STORAGE_KEY, newId);
      return sendThreadMessage(newId, message, user_fingerprint);
    }
    throw e;
  }
}
