import axios from "axios";
import type {
  Agency,
  Property,
  ScrapeJob,
  ChatThread,
  ChatMessage,
  ChatToolRun,
  ChatResponse,
  PricingData,
  AgencyFilters,
  PropertyFilters,
} from "@/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  headers: { "Content-Type": "application/json" },
  /** Without this, a stopped API leaves the UI spinning indefinitely (browser tab “loading”). */
  timeout: 15_000,
});

export async function scrapeCity(city: string, country: string): Promise<ScrapeJob> {
  const { data } = await api.post<ScrapeJob>("/api/scrape", { city, country });
  return data;
}

export async function getJobStatus(jobId: string): Promise<ScrapeJob> {
  const { data } = await api.get<ScrapeJob>(`/api/scrape/${jobId}`);
  return data;
}

export async function getAgencies(filters: AgencyFilters = {}): Promise<Agency[]> {
  const { data } = await api.get<Agency[]>("/api/agencies", { params: filters });
  return data;
}

export async function getAgency(id: string): Promise<Agency> {
  const { data } = await api.get<Agency>(`/api/agencies/${id}`);
  return data;
}

export async function deleteAgency(id: string): Promise<void> {
  await api.delete(`/api/agencies/${id}`);
}

export async function getProperties(filters: PropertyFilters = {}): Promise<Property[]> {
  const { data } = await api.get<Property[]>("/api/properties", { params: filters });
  return data;
}

export async function getPricingData(filters?: {
  city?: string;
  country?: string;
  property_type?: string;
  category?: string;
}): Promise<PricingData> {
  const { data } = await api.get<PricingData>("/api/pricing", { params: filters ?? {} });
  return data;
}

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

export async function listChatMessages(threadId: string): Promise<ChatMessage[]> {
  const { data } = await api.get<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`);
  return data;
}

export async function sendThreadMessage(
  threadId: string,
  message: string,
  user_fingerprint?: string,
): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>(`/api/chat/threads/${threadId}/messages`, {
    message,
    user_fingerprint,
  });
  return data;
}

const VOICE_THREAD_STORAGE_KEY = "aria_voice_thread_id";

/** Stateless-style call for the voice orb: reuses a dedicated thread stored in localStorage. */
export async function chatWithAgent(
  message: string,
  sessionId: string,
  history: unknown[] = [],
  user_fingerprint?: string,
): Promise<ChatResponse> {
  void sessionId;
  void history;
  if (typeof window === "undefined") {
    throw new Error("chatWithAgent is only available in the browser");
  }
  let threadId = localStorage.getItem(VOICE_THREAD_STORAGE_KEY);
  if (!threadId) {
    const thread = await createChatThread("ARIA Voice");
    threadId = thread.id;
    localStorage.setItem(VOICE_THREAD_STORAGE_KEY, threadId);
  }
  return sendThreadMessage(threadId, message, user_fingerprint);
}

export async function listThreadToolRuns(threadId: string): Promise<ChatToolRun[]> {
  const { data } = await api.get<ChatToolRun[]>(`/api/chat/threads/${threadId}/tool-runs`);
  return data;
}
