"use client";

import { FormEvent, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, Loader2, Mic, MicOff, MoreVertical, Pencil, Plus, Send, Trash2, User } from "lucide-react";
import {
  clearAllChatThreads,
  createChatThread,
  deleteChatThread,
  getAgencies,
  getJobStatus,
  listChatMessages,
  listChatThreads,
  sendThreadMessage,
  updateChatThread,
} from "@/lib/api";
import type { Agency, ChatMessage, ChatThread, Property, ScrapeJob } from "@/types";

function formatJobMessage(job: ScrapeJob) {
  return `Job ${job.status}: ${job.message} (${job.agencies_scraped}/${job.agencies_found || "?"})`;
}

const AGENCY_LIST_COLUMNS = [
  { key: "name", label: "Agency" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "website_url", label: "Website" },
] as const;

const PROPERTY_TABLE_COLUMNS: { key: keyof Property | string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "property_type", label: "Type" },
  { key: "category", label: "Category" },
  { key: "bedrooms", label: "Beds" },
  { key: "bathroom_count", label: "Baths" },
  { key: "bedroom_sqm", label: "Bed m²" },
  { key: "bathroom_sqm", label: "Bath m²" },
  { key: "total_sqm", label: "Total m²" },
  { key: "locality", label: "Locality" },
  { key: "price", label: "Price" },
  { key: "currency", label: "Cur" },
  { key: "listing_url", label: "Listing" },
];

function formatTableCell(v: unknown): ReactNode {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  const s = String(v);
  if (/^https?:\/\//i.test(s)) {
    const short = s.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return (
      <a href={s} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-blue)", wordBreak: "break-all" }}>
        {short}
      </a>
    );
  }
  return s;
}

function ChatAgencyTableBlock({
  caption,
  columns,
  rows,
}: {
  caption?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}) {
  return (
    <div
      style={{
        marginTop: "0.65rem",
        borderRadius: 10,
        border: "1px solid rgba(148,163,184,0.25)",
        overflow: "hidden",
        background: "rgba(15,23,42,0.45)",
      }}
    >
      {caption && (
        <div
          style={{
            padding: "0.4rem 0.65rem",
            fontSize: "0.72rem",
            fontWeight: 600,
            color: "var(--text-muted)",
            borderBottom: "1px solid var(--border)",
            letterSpacing: "0.02em",
          }}
        >
          {caption}
        </div>
      )}
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr style={{ background: "linear-gradient(180deg, rgba(37,99,235,0.18), rgba(37,99,235,0.06))" }}>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    textAlign: "left",
                    padding: "0.5rem 0.6rem",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    color: "var(--text-secondary)",
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderTop: "1px solid rgba(148,163,184,0.12)" }}>
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: "0.5rem 0.6rem", verticalAlign: "top", maxWidth: 240 }}>
                    {formatTableCell(row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChatAgencyDetailBlock({ agency, properties }: { agency: Agency; properties: Property[] }) {
  const chips: { label: string; value: string }[] = [
    { label: "Location", value: [agency.city, agency.country].filter(Boolean).join(", ") || "—" },
    { label: "Rating", value: agency.google_rating != null ? String(agency.google_rating) : "—" },
    { label: "Reviews", value: agency.review_count != null ? String(agency.review_count) : "—" },
    { label: "Owner / contact name", value: agency.owner_name || "—" },
    { label: "Focus", value: agency.specialization || "—" },
    {
      label: "Price band",
      value:
        agency.price_range_min != null && agency.price_range_max != null
          ? `${agency.currency || "EUR"} ${Number(agency.price_range_min).toLocaleString()} – ${Number(agency.price_range_max).toLocaleString()}`
          : "—",
    },
  ];

  const contactLines: string[] = [];
  if (agency.website_url) contactLines.push(`Web: ${agency.website_url}`);
  if (agency.email?.length) contactLines.push(`Email: ${agency.email.slice(0, 3).join(", ")}`);
  if (agency.phone?.length) contactLines.push(`Phone: ${agency.phone.slice(0, 3).join(", ")}`);
  if (agency.whatsapp) contactLines.push(`WhatsApp: ${agency.whatsapp}`);

  const social: string[] = [];
  if (agency.facebook_url) social.push(`Facebook: ${agency.facebook_url}`);
  if (agency.instagram_url) social.push(`Instagram: ${agency.instagram_url}`);
  if (agency.linkedin_url) social.push(`LinkedIn: ${agency.linkedin_url}`);
  if (agency.twitter_url) social.push(`X: ${agency.twitter_url}`);

  const propRows = properties.map((p) => {
    const o: Record<string, unknown> = {};
    for (const { key } of PROPERTY_TABLE_COLUMNS) {
      o[key] = p[key as keyof Property];
    }
    return o;
  });

  const cols = PROPERTY_TABLE_COLUMNS;

  return (
    <div style={{ marginTop: "0.65rem", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "0.45rem",
        }}
      >
        {chips.map((c) => (
          <div
            key={c.label}
            style={{
              borderRadius: 8,
              padding: "0.45rem 0.55rem",
              border: "1px solid rgba(148,163,184,0.2)",
              background: "rgba(15,23,42,0.35)",
            }}
          >
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: 2 }}>{c.label}</div>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, lineHeight: 1.35 }}>{c.value}</div>
          </div>
        ))}
      </div>
      {(contactLines.length > 0 || social.length > 0) && (
        <div
          style={{
            borderRadius: 10,
            padding: "0.55rem 0.65rem",
            border: "1px solid rgba(148,163,184,0.2)",
            background: "rgba(15,23,42,0.35)",
            fontSize: "0.78rem",
            lineHeight: 1.55,
          }}
        >
          {contactLines.length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--accent-gold)", fontSize: "0.72rem" }}>Contact</div>
              {contactLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </>
          )}
          {social.length > 0 && (
            <>
              <div
                style={{
                  fontWeight: 700,
                  marginTop: contactLines.length ? 8 : 0,
                  marginBottom: 4,
                  color: "var(--accent-gold)",
                  fontSize: "0.72rem",
                }}
              >
                Social
              </div>
              {social.map((line, i) => {
                const idx = line.indexOf(": ");
                const lab = idx >= 0 ? line.slice(0, idx) : "";
                const url = idx >= 0 ? line.slice(idx + 2) : line;
                return (
                  <div key={i}>
                    {lab && <span style={{ color: "var(--text-muted)" }}>{lab}: </span>}
                    {formatTableCell(url)}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      {propRows.length > 0 && (
        <ChatAgencyTableBlock caption={`Properties (${properties.length})`} columns={cols} rows={propRows} />
      )}
    </div>
  );
}

const ARIA_SUGGESTIONS = [
  "Show me 3 bedroom villas in Dubai",
  "What are the cheapest areas in Valletta, Malta?",
  "Find luxury apartments in London under £500k",
  "Compare Sliema vs Valletta pricing",
  "Which agency has most listings in Malta?",
  "Scrape real estate agencies in Barcelona, Spain",
];

/** Cycles while a reply is loading — mirrors backend TOOL_STATUS_LABELS order. */
const ARIA_TYPING_STATUS = [
  "🔍 ARIA is searching database...",
  "🌐 ARIA is visiting agency websites...",
  "🔎 ARIA is searching the web...",
  "📊 ARIA is analyzing prices...",
  "🏢 ARIA is loading agency profile...",
];

const TYPING_BY_ACTION: Record<string, string> = {
  conversation: "ARIA is responding...",
  search_database: "🔍 Searching database...",
  scrape_city: "🌐 Visiting agency websites... (2-3 min)",
  web_search: "🔎 Searching the web...",
  get_pricing_analysis: "📊 Analyzing pricing data...",
  compare_properties: "🧾 Comparing properties...",
  get_area_pricing: "📍 Checking area pricing...",
};

function inferTypingAction(text: string): string {
  const msg = text.toLowerCase();
  const casual = ["thanks", "thank you", "hello", "hi", "hey", "how are you", "great", "amazing"];
  if (casual.some((w) => msg.includes(w)) && msg.length < 90) return "conversation";
  if (msg.includes("scrape") || msg.includes("agency website") || msg.includes("agencies in")) return "scrape_city";
  if (msg.includes("trend") || msg.includes("news") || msg.includes("market")) return "web_search";
  if (msg.includes("price") || msg.includes("pricing") || msg.includes("per sqm") || msg.includes("avg")) return "get_pricing_analysis";
  return "search_database";
}

function ChatStructuredMeta({ meta }: { meta: Record<string, unknown> }) {
  const display = meta.display;
  if (display === "agency_table" && Array.isArray(meta.rows) && Array.isArray(meta.columns)) {
    return (
      <ChatAgencyTableBlock
        caption={typeof meta.caption === "string" ? meta.caption : undefined}
        columns={meta.columns as { key: string; label: string }[]}
        rows={meta.rows as Record<string, unknown>[]}
      />
    );
  }
  if (display === "agency_detail" && meta.agency && Array.isArray(meta.properties)) {
    return <ChatAgencyDetailBlock agency={meta.agency as Agency} properties={meta.properties as Property[]} />;
  }
  return null;
}

function ChatCompareBlock({ payload }: { payload: Record<string, unknown> }) {
  const rows = Array.isArray(payload.comparison_table) ? (payload.comparison_table as Array<Record<string, unknown>>) : [];
  const recommendation = typeof payload.recommendation === "string" ? payload.recommendation : "";
  if (!rows.length && !recommendation) return null;
  return (
    <div style={{ marginTop: "0.6rem", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 10, overflow: "hidden" }}>
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: i ? "1px solid rgba(148,163,184,0.12)" : "none" }}>
                <td style={{ padding: "0.45rem 0.6rem", color: "var(--text-muted)", minWidth: 120 }}>{String(r.criteria ?? "Criteria")}</td>
                <td style={{ padding: "0.45rem 0.6rem", color: "var(--text-secondary)" }}>
                  {Array.isArray(r.values) ? r.values.join(" | ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {recommendation && (
        <div style={{ borderTop: "1px solid rgba(226,181,90,0.25)", padding: "0.5rem 0.6rem", color: "var(--accent-gold)", fontSize: "0.75rem" }}>
          Recommendation: {recommendation}
        </div>
      )}
    </div>
  );
}

function ChatPageContent() {
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [typingStatusIdx, setTypingStatusIdx] = useState(0);
  const [pendingActionHint, setPendingActionHint] = useState<string>("search_database");
  const [userFingerprint, setUserFingerprint] = useState<string>("");
  const [welcomeBackSummary, setWelcomeBackSummary] = useState<string>("");
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [menuThreadId, setMenuThreadId] = useState<string>("");
  const [pageError, setPageError] = useState("");
  const [renameTarget, setRenameTarget] = useState<ChatThread | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);

  const submitUserMessageRef = useRef<(text: string) => Promise<void>>(async () => {});
  const sendingRef = useRef(sending);
  const activeThreadIdRef = useRef(activeThreadId);
  const voiceRecognitionRef = useRef<SpeechRecognition | null>(null);
  const voiceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTranscriptRef = useRef("");

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const refreshThreads = useCallback(async () => {
    const items = await listChatThreads();
    setThreads(items);
    setActiveThreadId((prev) => {
      if (items.some((i) => i.id === prev)) return prev;
      return items[0]?.id ?? "";
    });
    return items;
  }, []);

  useEffect(() => {
    const getUserFingerprint = () => {
      let fp = localStorage.getItem("aria_user_fp");
      if (!fp) {
        fp = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        localStorage.setItem("aria_user_fp", fp);
      }
      return fp;
    };
    setUserFingerprint(getUserFingerprint());
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      setLoadingThreads(true);
      try {
        const current = await refreshThreads();
        if (!current.length) {
          const created = await createChatThread("New Chat");
          setThreads([created]);
          setActiveThreadId(created.id);
        }
      } finally {
        setLoadingThreads(false);
      }
    };
    void bootstrap();
  }, [refreshThreads]);

  useEffect(() => {
    const loadMessages = async () => {
      if (!activeThreadId) return;
      setLoadingMessages(true);
      setPageError("");
      try {
        const data = await listChatMessages(activeThreadId);
        setMessages(data);
      } catch {
        // Thread may have been deleted in another action/session.
        const latest = await refreshThreads();
        if (!latest.length) {
          const created = await createChatThread("New Chat");
          setThreads([created]);
          setActiveThreadId(created.id);
          setMessages([]);
        } else {
          setActiveThreadId(latest[0].id);
        }
        setPageError("Chat session unavailable — switched to the latest thread.");
      } finally {
        setLoadingMessages(false);
      }
    };
    void loadMessages();
  }, [activeThreadId, refreshThreads]);

  useEffect(() => {
    if (!sending) {
      setTypingStatusIdx(0);
      return;
    }
    const id = setInterval(() => {
      setTypingStatusIdx((i) => (i + 1) % ARIA_TYPING_STATUS.length);
    }, 2600);
    return () => clearInterval(id);
  }, [sending]);

  useEffect(() => {
    const raw = searchParams.get("message");
    if (!raw?.trim()) return;
    try {
      setInput(decodeURIComponent(raw.replace(/\+/g, " ")));
    } catch {
      setInput(raw.replace(/\+/g, " "));
    }
  }, [searchParams]);

  const watchJob = async (jobId: string, city?: string, country?: string) => {
    let done = false;
    while (!done) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const status = await getJobStatus(jobId);
        setMessages((prev) => [
          ...prev,
          {
            id: `${jobId}-${Date.now()}`,
            thread_id: activeThreadId,
            role: "assistant",
            content: formatJobMessage(status),
            created_at: new Date().toISOString(),
          },
        ]);
        done = status.status === "complete" || status.status === "failed";
        if (done && status.status === "complete") {
          try {
            const fetched = await getAgencies({ city: city || status.city, country: country || status.country, page: 1, limit: 15 });
            const rows = fetched.map((a) => ({
              id: a.id,
              name: a.name,
              city: a.city ?? "",
              country: a.country ?? "",
              website_url: a.website_url ?? "",
            }));
            setMessages((prev) => [
              ...prev,
              {
                id: `${jobId}-table-${Date.now()}`,
                thread_id: activeThreadId,
                role: "assistant",
                content:
                  fetched.length > 0
                    ? `Here is the latest agency list (${fetched.length}). Ask about any agency by name for full scraped details.`
                    : "Scrape completed but no agencies were returned yet.",
                created_at: new Date().toISOString(),
                meta: {
                  display: "agency_table",
                  caption: `${fetched.length} agencies`,
                  columns: [...AGENCY_LIST_COLUMNS],
                  rows,
                },
              },
            ]);
          } catch {
            // no-op, status message already shown
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `${jobId}-err-${Date.now()}`,
            thread_id: activeThreadId,
            role: "assistant",
            content: "Could not fetch job status. Please try again in a moment.",
            created_at: new Date().toISOString(),
          },
        ]);
        done = true;
      }
    }
  };

  const createThread = async () => {
    const item = await createChatThread("New Chat");
    setThreads((prev) => [item, ...prev]);
    setActiveThreadId(item.id);
    setMessages([]);
  };

  const renameThread = async (thread: ChatThread) => {
    const next = renameValue.trim();
    if (!next) return;
    const updated = await updateChatThread(thread.id, { title: next });
    setThreads((prev) => prev.map((t) => (t.id === thread.id ? updated : t)));
    setRenameTarget(null);
    setRenameValue("");
    setMenuThreadId("");
  };

  const removeThread = async (thread: ChatThread) => {
    try {
      await deleteChatThread(thread.id);
      const remaining = threads.filter((t) => t.id !== thread.id);
      setThreads(remaining);
      setMenuThreadId("");
      if (activeThreadId === thread.id) {
        if (remaining[0]) {
          setActiveThreadId(remaining[0].id);
        } else {
          await createThread();
        }
      }
    } catch {
      setPageError("Delete failed. Please try again.");
    }
  };

  const clearAllThreads = async () => {
    try {
      await clearAllChatThreads();
      setThreads([]);
      setMessages([]);
      setActiveThreadId("");
      setMenuThreadId("");
      await createThread();
    } catch {
      setPageError("Clear all failed. Please try again.");
    }
  };

  const stopVoiceDebounce = useCallback(() => {
    if (voiceDebounceRef.current) {
      clearTimeout(voiceDebounceRef.current);
      voiceDebounceRef.current = null;
    }
  }, []);

  const submitUserMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending || !activeThreadId) return;

      const wasEmpty = messages.length === 0;

      setInput("");
      setMessages((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}`,
          thread_id: activeThreadId,
          role: "user",
          content: trimmed,
          created_at: new Date().toISOString(),
        },
      ]);
      setPendingActionHint(inferTypingAction(trimmed));
      setSending(true);

      try {
        const res = await sendThreadMessage(activeThreadId, trimmed, userFingerprint || undefined);
        if (typeof res.action === "string" && res.action) {
          setPendingActionHint(res.action);
        }
        const mm =
          res.message_meta && typeof res.message_meta === "object" ? (res.message_meta as Record<string, unknown>) : {};
        if (wasEmpty && mm.is_returning_user && typeof mm.memory_summary === "string" && mm.memory_summary.trim()) {
          setWelcomeBackSummary(mm.memory_summary.trim());
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            thread_id: activeThreadId,
            role: "assistant",
            content: res.reply,
            created_at: new Date().toISOString(),
            meta: { action: res.action, ...(res.message_meta && typeof res.message_meta === "object" ? res.message_meta : {}) },
          },
        ]);
        if (res.job?.job_id) {
          void watchJob(res.job.job_id, res.job.city, res.job.country);
        }
        await refreshThreads();
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            thread_id: activeThreadId,
            role: "assistant",
            content: "Unable to reach backend right now. Please check backend server and try again.",
            created_at: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [
      activeThreadId,
      messages.length,
      refreshThreads,
      sending,
      userFingerprint,
      watchJob,
    ],
  );

  useEffect(() => {
    submitUserMessageRef.current = submitUserMessage;
  }, [submitUserMessage]);

  useEffect(() => {
    return () => {
      stopVoiceDebounce();
      voiceRecognitionRef.current?.stop();
    };
  }, [stopVoiceDebounce]);

  const toggleChatVoiceInput = () => {
    if (voiceListening) {
      voiceRecognitionRef.current?.stop();
      stopVoiceDebounce();
      setVoiceListening(false);
      return;
    }

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      alert("Voice not supported in this browser. Try Chrome.");
      return;
    }
    if (!activeThreadId || sending) return;

    voiceTranscriptRef.current = "";
    setVoiceListening(true);

    const recognition = new Ctor();
    voiceRecognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const next = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      voiceTranscriptRef.current = next;
      setInput(next);
      stopVoiceDebounce();
      voiceDebounceRef.current = setTimeout(() => {
        const t = voiceTranscriptRef.current.trim();
        if (t && !sendingRef.current && activeThreadIdRef.current) {
          voiceRecognitionRef.current?.stop();
          void submitUserMessageRef.current(t);
        }
        voiceDebounceRef.current = null;
      }, 1000);
    };

    recognition.onerror = () => {
      setVoiceListening(false);
      stopVoiceDebounce();
    };

    recognition.onend = () => {
      setVoiceListening(false);
    };

    recognition.start();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await submitUserMessage(input);
  };

  return (
    <div style={{ height: "calc(100vh - 60px)", background: "var(--bg-base)", padding: "0.9rem", minHeight: 0 }}>
      <div
        style={{
          height: "100%",
          width: "100%",
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "300px 1fr",
          gridTemplateRows: "minmax(0, 1fr)",
          gap: "0.9rem",
        }}
      >
        <aside
          className="card"
          style={{
            borderRadius: 12,
            border: "1px solid var(--border)",
            padding: "0.75rem",
            minHeight: 0,
            height: "100%",
            maxHeight: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            onClick={createThread}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginBottom: "0.75rem",
              padding: "0.6rem 0.75rem",
              background: "rgba(37,99,235,0.2)",
              border: "1px solid rgba(37,99,235,0.45)",
              color: "#fff",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <Plus size={14} /> New Chat
          </button>
          <button
            type="button"
            onClick={clearAllThreads}
            style={{
              width: "100%",
              marginBottom: "0.65rem",
              padding: "0.45rem 0.6rem",
              borderRadius: 8,
              border: "1px solid rgba(239,68,68,0.35)",
              color: "#fda4af",
              background: "rgba(239,68,68,0.08)",
              cursor: "pointer",
              fontSize: "0.78rem",
            }}
          >
            Clear All Sessions
          </button>
          <div
            className="chat-scroll"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              flex: "1 1 0",
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
              WebkitOverflowScrolling: "touch",
              paddingRight: 6,
              scrollbarWidth: "thin",
            }}
          >
            {loadingThreads && <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Loading chats...</div>}
            {!loadingThreads &&
              threads.map((thread) => (
                <div
                  key={thread.id}
                  style={{
                    padding: "0.55rem",
                    borderRadius: 8,
                    border: `1px solid ${activeThreadId === thread.id ? "rgba(37,99,235,0.5)" : "var(--border)"}`,
                    background: activeThreadId === thread.id ? "rgba(37,99,235,0.12)" : "transparent",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setActiveThreadId(thread.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <div style={{ fontSize: "0.83rem", fontWeight: 600, marginBottom: 4 }}>{thread.title}</div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                      {thread.last_message_preview || "No messages yet"}
                    </div>
                  </button>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6, position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setMenuThreadId((prev) => (prev === thread.id ? "" : thread.id))}
                      style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}
                    >
                      <MoreVertical size={14} />
                    </button>
                    {menuThreadId === thread.id && (
                      <div
                        style={{
                          position: "absolute",
                          top: 20,
                          right: 0,
                          minWidth: 120,
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: "var(--bg-card)",
                          zIndex: 40,
                          padding: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setRenameTarget(thread);
                            setRenameValue(thread.title);
                            setMenuThreadId("");
                          }}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: "transparent",
                            border: "none",
                            color: "var(--text-secondary)",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            padding: "0.35rem 0.45rem",
                            textAlign: "left",
                          }}
                        >
                          <Pencil size={12} /> Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => removeThread(thread)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: "transparent",
                            border: "none",
                            color: "#fda4af",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            padding: "0.35rem 0.45rem",
                            textAlign: "left",
                          }}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </aside>

        <div>
          <div
            style={{
              marginBottom: "0.8rem",
              position: "sticky",
              top: 60,
              zIndex: 5,
              paddingTop: "0.35rem",
              paddingBottom: "0.45rem",
              background: "var(--bg-base)",
            }}
          >
            <h1 style={{ fontSize: "1.45rem", color: "var(--text-primary)", fontWeight: 800 }}>
              ARIA · Intelligence Chat
            </h1>
          </div>
          {pageError && (
            <div style={{ marginBottom: "0.6rem", color: "#fda4af", fontSize: "0.78rem" }}>{pageError}</div>
          )}
          {!!welcomeBackSummary && (
            <div
              style={{
                marginBottom: "0.6rem",
                border: "1px solid rgba(226,181,90,0.35)",
                background: "rgba(226,181,90,0.1)",
                color: "var(--accent-gold)",
                borderRadius: 10,
                padding: "0.5rem 0.65rem",
                fontSize: "0.78rem",
              }}
            >
              Welcome back! {welcomeBackSummary}
            </div>
          )}

          <div
            className="card chat-scroll"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              minHeight: 0,
              height: "calc(100% - 126px)",
              overflowY: "auto",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              marginBottom: "0.8rem",
            }}
          >
            {loadingMessages && <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Loading messages...</div>}
            {!loadingMessages && messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Try one of these with ARIA:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                  {ARIA_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setInput(s)}
                      style={{
                        fontSize: "0.72rem",
                        padding: "0.35rem 0.55rem",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.04)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", gap: 8 }}>
                  <div
                    style={{
                      marginTop: 3,
                      color: m.role === "user" ? "var(--accent-blue)" : "var(--accent-gold)",
                      flexShrink: 0,
                    }}
                  >
                    {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
                  </div>
                  <div
                    style={{
                      padding: "0.65rem 0.8rem",
                      borderRadius: 10,
                      background: m.role === "user" ? "rgba(37,99,235,0.16)" : "rgba(255,255,255,0.05)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      fontSize: "0.86rem",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.content}
                    {m.role === "assistant" && m.meta && typeof m.meta.display === "string" && (
                      <ChatStructuredMeta meta={m.meta as Record<string, unknown>} />
                    )}
                    {m.role === "assistant" &&
                      m.meta &&
                      (m.meta as { compare_result?: Record<string, unknown> }).compare_result && (
                        <ChatCompareBlock payload={(m.meta as { compare_result: Record<string, unknown> }).compare_result} />
                      )}
                  </div>
                </div>
                {m.role === "assistant" && m.meta && typeof (m.meta as { aria_actions_line?: string }).aria_actions_line === "string" && (
                  <div style={{ marginLeft: 22, fontSize: "0.68rem", color: "var(--text-muted)", lineHeight: 1.35 }}>
                    {(m.meta as { aria_actions_line?: string }).aria_actions_line}
                  </div>
                )}
                {m.role === "assistant" && m.meta && (m.meta as { action?: string }).action && !(m.meta as { aria?: boolean }).aria && (
                  <div style={{ marginLeft: 22, fontSize: "0.65rem", color: "var(--text-muted)", opacity: 0.85 }}>
                    Action: {(m.meta as { action?: string }).action}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div
                style={{
                  alignSelf: "flex-start",
                  maxWidth: "85%",
                  display: "flex",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    marginTop: 3,
                    color: "var(--accent-gold)",
                    flexShrink: 0,
                  }}
                >
                  <Bot size={14} />
                </div>
                <div
                  style={{
                    padding: "0.55rem 0.75rem",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--border)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span className="typing-dot" />
                  <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
                  <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
                  <span
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                      maxWidth: "min(240px, 70vw)",
                      lineHeight: 1.35,
                    }}
                  >
                    {TYPING_BY_ACTION[pendingActionHint] ?? ARIA_TYPING_STATUS[typingStatusIdx]}
                  </span>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
            <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
              {voiceListening && (
                <span
                  title="Listening…"
                  style={{
                    position: "absolute",
                    left: 12,
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--red)",
                    animation: "voicePulse 1.2s ease-in-out infinite",
                    pointerEvents: "none",
                  }}
                />
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask ARIA — properties, agencies, pricing, or scrape a city…"
                style={{
                  flex: 1,
                  width: "100%",
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${voiceListening ? "rgba(239,68,68,0.45)" : "var(--border)"}`,
                  borderRadius: 10,
                  color: "var(--text-primary)",
                  padding: voiceListening ? "0.75rem 0.9rem 0.75rem 1.85rem" : "0.75rem 0.9rem",
                  fontSize: "0.88rem",
                  boxShadow: voiceListening ? "0 0 0 1px rgba(239,68,68,0.12)" : undefined,
                }}
              />
            </div>
            <button
              type="button"
              onClick={toggleChatVoiceInput}
              disabled={sending || !activeThreadId}
              title={voiceListening ? "Stop voice input" : "Voice input"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderRadius: 10,
                border: `1px solid ${voiceListening ? "rgba(239,68,68,0.5)" : "rgba(148,163,184,0.35)"}`,
                padding: "0 0.85rem",
                background: voiceListening ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)",
                color: "#fff",
                cursor: sending || !activeThreadId ? "not-allowed" : "pointer",
                opacity: sending || !activeThreadId ? 0.5 : 1,
              }}
            >
              {voiceListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              type="submit"
              disabled={!canSend}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderRadius: 10,
                border: "1px solid rgba(37,99,235,0.45)",
                padding: "0 1rem",
                background: canSend ? "rgba(37,99,235,0.25)" : "rgba(255,255,255,0.04)",
                color: "#fff",
                minWidth: 98,
                cursor: canSend ? "pointer" : "not-allowed",
              }}
            >
              {sending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={14} />}
              Send
            </button>
          </form>
        </div>
      </div>
      <style>{`
        .chat-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .chat-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); border-radius: 999px; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(96,165,250,0.5); border-radius: 999px; border: 2px solid rgba(15,23,42,0.8); }
        .chat-scroll::-webkit-scrollbar-thumb:hover { background: rgba(96,165,250,0.75); }
        .typing-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.85);
          display: inline-block;
          animation: typingBounce 0.9s infinite ease-in-out;
        }
        @keyframes typingBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes voicePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.25); opacity: 0.65; }
        }
      `}</style>
      {renameTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(2,6,23,0.72)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            className="card gradient-border"
            style={{
              width: "min(420px, 100%)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              padding: "1rem",
            }}
          >
            <h3 style={{ color: "var(--text-primary)", fontSize: "1rem", fontWeight: 700, marginBottom: 6 }}>
              Rename Chat
            </h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: 10 }}>
              Enter a new title for this session.
            </p>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-primary)",
                padding: "0.55rem 0.75rem",
                fontSize: "0.85rem",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setRenameTarget(null);
                  setRenameValue("");
                }}
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--text-secondary)",
                  padding: "0.42rem 0.85rem",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void renameThread(renameTarget)}
                style={{
                  borderRadius: 8,
                  border: "1px solid rgba(37,99,235,0.45)",
                  background: "rgba(37,99,235,0.2)",
                  color: "#dbeafe",
                  padding: "0.42rem 0.85rem",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "3rem", color: "var(--text-muted)", textAlign: "center", background: "var(--bg-base)" }}>
          Loading chat…
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
