-- ── Session state column on chat_threads ─────────────────────────────────
-- Run this once in Supabase SQL Editor.
-- Adds state_json to chat_threads to store:
--   preferences, agency_list, current_agency_index, search_phase
-- This makes ARIA stateless — state lives in DB, not in conversation parsing.

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS state_json TEXT DEFAULT NULL;

-- Optional: index for quick reads (not required but cheap)
-- CREATE INDEX IF NOT EXISTS idx_chat_threads_state ON chat_threads (id)
-- WHERE state_json IS NOT NULL;

COMMENT ON COLUMN chat_threads.state_json IS
  'JSON session state: {preferences, agency_list, current_agency_index, search_phase}';
