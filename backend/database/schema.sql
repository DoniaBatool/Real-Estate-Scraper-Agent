-- ============================================================
-- ARIA Real Estate Agent — Supabase Schema v2
-- Only chat history is stored. Property data is always live.
-- Run this in your Supabase SQL Editor.
-- ============================================================

-- Drop old tables if migrating from v1
DROP TABLE IF EXISTS chat_tool_runs   CASCADE;
DROP TABLE IF EXISTS chat_summaries   CASCADE;
DROP TABLE IF EXISTS chat_messages    CASCADE;
DROP TABLE IF EXISTS chat_threads     CASCADE;
DROP TABLE IF EXISTS properties       CASCADE;
DROP TABLE IF EXISTS agencies         CASCADE;
DROP TABLE IF EXISTS conversation_embeddings CASCADE;
DROP TABLE IF EXISTS user_memory      CASCADE;

-- ── Chat Threads ──────────────────────────────────────────────────────────
CREATE TABLE chat_threads (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL DEFAULT 'New Chat',
    archived   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_threads_updated  ON chat_threads (updated_at DESC);
CREATE INDEX idx_chat_threads_archived ON chat_threads (archived);

-- ── Chat Messages ─────────────────────────────────────────────────────────
CREATE TABLE chat_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id  UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content    TEXT NOT NULL,
    meta_json  TEXT,          -- JSON: tool traces, scraped properties, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_thread ON chat_messages (thread_id, created_at ASC);

-- ── Chat Summaries (for long thread compression) ──────────────────────────
CREATE TABLE chat_summaries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id     UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    summary       TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_summaries_thread ON chat_summaries (thread_id, created_at DESC);

-- ── Chat Tool Runs (for observability / debugging) ────────────────────────
CREATE TABLE chat_tool_runs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id      UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    message_id     UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    tool_name      TEXT NOT NULL,
    tool_args_json TEXT,
    rationale      TEXT,
    status         TEXT NOT NULL DEFAULT 'started',
    output_json    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_tool_runs_thread ON chat_tool_runs (thread_id, created_at DESC);

-- ── Auto-update updated_at on chat_threads ────────────────────────────────
CREATE OR REPLACE FUNCTION update_chat_thread_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_threads SET updated_at = now() WHERE id = NEW.thread_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chat_messages_update_thread
    AFTER INSERT ON chat_messages
    FOR EACH ROW EXECUTE FUNCTION update_chat_thread_timestamp();
