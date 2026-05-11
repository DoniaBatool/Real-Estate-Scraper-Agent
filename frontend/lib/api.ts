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

/** Empty string env would make axios hit the Next origin (`/api/...` → 404). */
export const API_BASE_URL =
  (typeof process.env.NEXT_PUBLIC_API_URL === "string" && process.env.NEXT_PUBLIC_API_URL.trim()) ||
  "http://localhost:8000";

/**
 * Browser: same-origin `/api/...` → `app/api/[...path]/route.ts` proxies to FastAPI.
 * SSR / Node still calls FastAPI directly via API_BASE_URL.
 */
function axiosBaseURL(): string {
  if (typeof window === "undefined") return API_BASE_URL;
  return "";
}

const api = axios.create({
  baseURL: axiosBaseURL(),
  headers: { "Content-Type": "application/json" },
  /** Slow DB/cold API still needs to finish; long ops override per-request (e.g. workbench). */
  timeout: 60_000,
});

export async function scrapeCity(city: string, country: string): Promise<ScrapeJob> {
  const { data } = await api.post<ScrapeJob>("/api/scrape", { city, country });
  return data;
}

export async function getJobStatus(jobId: string): Promise<ScrapeJob> {
  const { data } = await api.get<ScrapeJob>(`/api/scrape/${jobId}`);
  return data;
}

export async function repairAgency(agencyId: string): Promise<ScrapeJob> {
  const { data } = await api.post<ScrapeJob>("/api/scrape/repair-agency", {
    agency_id: agencyId,
  });
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

  try {
    return await sendThreadMessage(threadId, message, user_fingerprint);
  } catch (e: unknown) {
    // Stale ID after DB reset, "clear all threads", or another device — recreate once.
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

export async function listThreadToolRuns(threadId: string): Promise<ChatToolRun[]> {
  const { data } = await api.get<ChatToolRun[]>(`/api/chat/threads/${threadId}/tool-runs`);
  return data;
}

const LONG_MS = 600_000;
/** Apify Google Places actor can run several minutes; must exceed backend wait_secs. */
const WORKBENCH_DISCOVER_MS = 720_000;

/** Shown when `/api/workbench/hoq/*` returns 404 — almost always a stale uvicorn process. */
export const HOQ_RESTART_HINT =
  "HOQ API returned 404 — the FastAPI process is probably older than the code. From the project root, use the project venv (not system Python): source .venv/bin/activate && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload";

/** Client or server: GET ping — `missing` means HOQ routes not registered (restart uvicorn). */
export async function hoqPingStatus(): Promise<"ok" | "missing" | "error"> {
  const url =
    typeof window === "undefined"
      ? `${API_BASE_URL}/api/workbench/hoq/ping`
      : "/api/workbench/hoq/ping";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) return "missing";
    if (!res.ok) return "error";
    const data = (await res.json()) as { ok?: boolean };
    return data?.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

export function isWorkbenchHoq404(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 404;
}

export type WorkbenchAgency = {
  name?: string;
  address?: string;
  phone?: string;
  google_rating?: number | null;
  review_count?: number | null;
  website_url?: string;
  city?: string;
  country?: string;
};

/** One discovered anchor from Playwright (fetch-urls). */
export type WorkbenchLinkEntry = {
  url: string;
  text?: string;
  is_nav?: boolean;
};

export type WorkbenchUrlBuckets = {
  property_pages: WorkbenchLinkEntry[];
  listing_pages: WorkbenchLinkEntry[];
  about_pages: WorkbenchLinkEntry[];
  contact_pages: WorkbenchLinkEntry[];
  other_pages: WorkbenchLinkEntry[];
};

export type FetchUrlsResponse = {
  website_url?: string;
  total_urls?: number;
  domain?: string;
  groups: WorkbenchUrlBuckets;
  error?: string;
  /** e.g. missing Playwright browsers / JS-only site */
  warning?: string;
  /** HTML pages successfully opened during BFS crawl */
  pages_visited?: number;
  crawl_max_pages?: number;
  /** Every unique internal URL collected (same netloc), sorted */
  all_urls?: string[];
};

/** Apify agency discovery; country is always Malta (enforced server-side). */
export async function workbenchDiscover(city: string): Promise<WorkbenchAgency[]> {
  const { data } = await api.post<WorkbenchAgency[]>(
    "/api/workbench/discover",
    { city, country: "Malta" },
    { timeout: WORKBENCH_DISCOVER_MS },
  );
  return data;
}

/** Full-site Playwright BFS can exceed 15+ minutes on large sites (axios must outlive the crawl). */
const FETCH_URLS_MS = 3_600_000;

export async function workbenchFetchUrls(
  website_url: string,
  max_pages: number = 400,
): Promise<FetchUrlsResponse> {
  const { data } = await api.post<FetchUrlsResponse>(
    "/api/workbench/fetch-urls",
    { website_url, max_pages: Math.min(800, Math.max(1, max_pages)) },
    { timeout: FETCH_URLS_MS },
  );
  return data;
}

const QUALIFY_PROPERTY_URLS_MS = 900_000;

export type QualifyPropertyUrlRow = {
  url: string;
  reference?: string | null;
  preview?: string | null;
  signals?: Record<string, boolean>;
  score?: number;
};

export type QualifyPropertyUrlsResponse = {
  qualified_total: number;
  rejected_total: number;
  qualified: QualifyPropertyUrlRow[];
  rejected_sample: { url: string; reason?: string; score?: number }[];
};

export async function workbenchQualifyPropertyUrls(
  urls: string[],
  options?: { require_agent?: boolean; concurrency?: number },
): Promise<QualifyPropertyUrlsResponse> {
  const { data } = await api.post<QualifyPropertyUrlsResponse>(
    "/api/workbench/qualify-property-urls",
    {
      urls: urls.slice(0, 500),
      require_agent: options?.require_agent ?? false,
      concurrency: options?.concurrency ?? 6,
    },
    { timeout: QUALIFY_PROPERTY_URLS_MS },
  );
  return data;
}

export type MatchReferenceUrlsResponse = {
  reference: string;
  scanned: number;
  matched: { url: string; source: "url" | "html" }[];
};

export async function workbenchMatchReferenceUrls(payload: {
  reference: string;
  urls: string[];
  max_scan?: number;
  max_matches?: number;
  concurrency?: number;
}): Promise<MatchReferenceUrlsResponse> {
  const { data } = await api.post<MatchReferenceUrlsResponse>(
    "/api/workbench/match-reference-urls",
    {
      reference: payload.reference,
      urls: payload.urls.slice(0, 2000),
      max_scan: payload.max_scan ?? 400,
      max_matches: payload.max_matches ?? 25,
      concurrency: payload.concurrency ?? 6,
    },
    { timeout: QUALIFY_PROPERTY_URLS_MS },
  );
  return data;
}

export type ExtractResultItem = {
  url: string;
  success: boolean;
  error?: string | null;
  data?: Record<string, unknown> | null;
  kind?: string | null;
};

export async function workbenchExtract(urls: string[]): Promise<{
  results: ExtractResultItem[];
  total?: number;
}> {
  const { data } = await api.post<{ results: ExtractResultItem[]; total?: number }>(
    "/api/workbench/extract",
    { urls },
    { timeout: LONG_MS },
  );
  return data;
}

export async function workbenchSave(payload: {
  data: Record<string, unknown>[];
  agency_name: string;
  city: string;
  country: string;
  website_url: string;
}): Promise<{ saved: number; error?: string }> {
  const { data } = await api.post<{ saved: number; error?: string }>(
    "/api/workbench/save",
    payload,
    { timeout: 120_000 },
  );
  return data;
}

export async function workbenchExportExcelBlob(
  data: Record<string, unknown>[],
  filename: string,
): Promise<Blob> {
  const response = await api.post(
    "/api/workbench/export-excel",
    { data, filename },
    { responseType: "blob", timeout: 120_000 },
  );
  return response.data as Blob;
}

/** Homes of Quality — listing grid scrape (Playwright + LLM). */
export async function hoqScrapeList(
  url: string,
  page: number,
  pageCount: number = 1,
): Promise<{
  properties: Record<string, unknown>[];
  has_more: boolean;
  page: number;
  page_count?: number;
  pages_fetched?: number;
  total_pages?: number | null;
  url_used?: string;
  error?: string;
}> {
  const pc = Math.max(1, Math.min(100, Math.floor(pageCount) || 1));
  const timeout = Math.min(3_600_000, LONG_MS + pc * 120_000);
  try {
    const { data } = await api.post<{
      properties: Record<string, unknown>[];
      has_more: boolean;
      page: number;
      page_count?: number;
      pages_fetched?: number;
      total_pages?: number | null;
      url_used?: string;
      error?: string;
    }>("/api/workbench/hoq/scrape-list", { url, page, page_count: pc }, { timeout });
    return data;
  } catch (e) {
    if (isWorkbenchHoq404(e)) throw new Error(HOQ_RESTART_HINT);
    throw e;
  }
}

export type HoqDetailResultItem = {
  reference: string;
  success: boolean;
  error?: string | null;
  data?: Record<string, unknown> | null;
};

export async function hoqScrapeDetail(references: string[]): Promise<{
  results: HoqDetailResultItem[];
  total?: number;
}> {
  try {
    const { data } = await api.post<{ results: HoqDetailResultItem[]; total?: number }>(
      "/api/workbench/hoq/scrape-detail",
      { references },
      { timeout: LONG_MS },
    );
    return data;
  } catch (e) {
    if (isWorkbenchHoq404(e)) throw new Error(HOQ_RESTART_HINT);
    throw e;
  }
}
