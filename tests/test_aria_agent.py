"""
ARIA Comprehensive Test Suite
==============================
Tests ALL scenarios, intent types, edge cases, and the self-improvement loop.

Run with:
    cd backend && python -m pytest ../tests/test_aria_agent.py -v

No API calls are made — all LLM / tool calls are mocked.
"""
from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# ── Helpers for fake ORM messages ─────────────────────────────────────────

def _msg(role: str, content: str) -> MagicMock:
    m = MagicMock()
    m.role = role
    m.content = content
    return m


def _history(*pairs: tuple[str, str]) -> list[MagicMock]:
    return [_msg(role, content) for role, content in pairs]


# ═══════════════════════════════════════════════════════════════════════════
# 1. INTENT DETECTION
# ═══════════════════════════════════════════════════════════════════════════

class TestDetectIntent:
    from backend.ai.aria_agent import detect_intent

    # Social intents
    @pytest.mark.parametrize("msg", [
        "thanks", "thank you", "great job", "shukriya", "bohot acha", "good job", "thats great",
    ])
    def test_appreciation(self, msg):
        from backend.ai.aria_agent import detect_intent
        assert detect_intent(msg) == "appreciation"

    @pytest.mark.parametrize("msg", [
        "hello", "hey", "salam", "good morning", "how are you", "kya haal",
    ])
    def test_greeting(self, msg):
        from backend.ai.aria_agent import detect_intent
        assert detect_intent(msg) == "greeting"

    @pytest.mark.parametrize("msg", [
        "you are smart", "you're the best agent", "so impressive",
    ])
    def test_compliment(self, msg):
        from backend.ai.aria_agent import detect_intent
        assert detect_intent(msg) == "compliment"

    # Task intents — must NOT be misclassified
    @pytest.mark.parametrize("msg", [
        "find apartments in Dubai",
        "I want to buy a villa in Malta",
        "show me properties in London",
        "2 bedroom apartment for rent",
        "what is the market like in Barcelona",
        "mujhe Dubai mein apartment chahiye",
    ])
    def test_task(self, msg):
        from backend.ai.aria_agent import detect_intent
        assert detect_intent(msg) == "task"


# ═══════════════════════════════════════════════════════════════════════════
# 2. INTENT HINT — CLARIFYING QUESTIONS
# ═══════════════════════════════════════════════════════════════════════════

class TestBuildIntentHint:
    from backend.ai.aria_agent import _build_intent_hint

    def _hint(self, msg, urls=None, prefs=None, city="", country="", correction=""):
        from backend.ai.aria_agent import _build_intent_hint
        return _build_intent_hint(msg, urls or [], prefs or {}, city, country, correction)

    # ── Missing location ────────────────────────────────────────────────
    def test_search_missing_location(self):
        h = self._hint("find me apartments")
        assert "location is MISSING" in h or "city & country" in h.lower() or "city and country" in h.lower()

    def test_search_missing_location_urdu(self):
        h = self._hint("mujhe ghar chahiye")
        assert "location" in h.lower() or "city" in h.lower()

    def test_pref_only_no_location(self):
        h = self._hint("2 bedroom apartment with pool")
        assert "city" in h.lower() or "location" in h.lower()

    def test_villa_no_location(self):
        h = self._hint("I want a villa with a garden")
        assert "city" in h.lower() or "location" in h.lower()

    # ── Has location → should trigger find_agencies ─────────────────────
    def test_search_with_location_calls_find_agencies(self):
        h = self._hint("find apartments in Dubai, UAE")
        assert "find_agencies" in h

    def test_search_in_malta(self):
        h = self._hint("show me properties in Malta")
        assert "find_agencies" in h

    def test_search_in_london(self):
        h = self._hint("I want to buy in London")
        assert "find_agencies" in h

    # ── URL shared ───────────────────────────────────────────────────────
    def test_url_no_prefs_asks_questions(self):
        h = self._hint("check this site: https://agency.com/listings")
        assert "DO NOT call scrape_website" in h or "Do NOT call scrape_website" in h
        assert "buy or rent" in h.lower() or "buying or renting" in h.lower()

    def test_url_with_prefs_scrape_immediately(self):
        h = self._hint("check https://agency.com rent 2 bed apartment")
        assert "scrape_website" in h

    # ── Preference reply → scrape immediately ───────────────────────────
    def test_pref_reply_triggers_scrape(self):
        urls = ["https://agency1.com", "https://agency2.com"]
        h = self._hint("I want to buy, 3 bedrooms, no specific budget", urls=urls, city="Dubai", country="UAE")
        assert "MANDATORY TOOL CALL" in h
        assert "scrape_website" in h
        assert "agency1.com" in h

    def test_pref_reply_no_budget(self):
        # Provide a city so it doesn't hit the "no location" guard first
        urls = ["https://agency.com"]
        h = self._hint("rent, flexible budget, apartment", urls=urls, city="Dubai", country="UAE")
        assert "NO min_price" in h or "no_budget" in h.lower() or "NO min_price or max_price" in h

    def test_pref_reply_show_all(self):
        urls = ["https://agency.com"]
        h = self._hint("show all", urls=urls)
        assert "scrape_website" in h

    # ── Navigation ───────────────────────────────────────────────────────
    def test_next_agency(self):
        urls = ["https://a1.com", "https://a2.com"]
        h = self._hint("next", urls=urls)
        assert "NEXT agency" in h
        assert "a2.com" in h

    def test_next_agency_urdu(self):
        urls = ["https://a1.com", "https://a2.com"]
        h = self._hint("agla", urls=urls)
        assert "NEXT agency" in h

    def test_more_same_site(self):
        urls = ["https://a1.com"]
        h = self._hint("more from this site", urls=urls)
        assert "SAME site" in h
        assert "a1.com" in h

    # ── Market questions ─────────────────────────────────────────────────
    def test_market_question_with_location(self):
        h = self._hint("how much does property cost in Dubai", city="Dubai", country="UAE")
        assert "market_insights" in h

    def test_market_question_no_location(self):
        h = self._hint("how much does property cost?")
        assert "city" in h.lower() or "which city" in h.lower()

    def test_investment_question_no_location(self):
        h = self._hint("is it good to invest right now?")
        assert "city" in h.lower()

    # ── Comparison ───────────────────────────────────────────────────────
    def test_compare_intent(self):
        h = self._hint("compare these properties")
        assert "compare_properties" in h

    def test_versus_intent(self):
        h = self._hint("which one is better, option 1 vs option 2")
        assert "compare_properties" in h

    # ── Auto-correction hint passthrough ─────────────────────────────────
    def test_correction_hint_injected(self):
        h = self._hint("find apartments in Dubai", correction="Ask for bedrooms before scraping")
        assert "AUTO-CORRECTION" in h
        assert "Ask for bedrooms" in h


# ═══════════════════════════════════════════════════════════════════════════
# 3. HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════

class TestHelpers:

    def test_has_location_with_in(self):
        from backend.ai.aria_agent import _has_location
        assert _has_location("apartments in Dubai") is True
        assert _has_location("properties in Malta") is True

    def test_has_location_known_city(self):
        from backend.ai.aria_agent import _has_location
        assert _has_location("Dubai apartments") is True
        assert _has_location("london properties") is True

    def test_no_location(self):
        from backend.ai.aria_agent import _has_location
        assert _has_location("apartments with pool") is False
        assert _has_location("2 bedroom flat") is False

    def test_is_urdu(self):
        from backend.ai.aria_agent import _is_urdu_message
        assert _is_urdu_message("mujhe apartment chahiye") is True
        assert _is_urdu_message("ghar dikhao mujhay") is True

    def test_is_not_urdu(self):
        from backend.ai.aria_agent import _is_urdu_message
        assert _is_urdu_message("show me apartments in Dubai") is False

    def test_is_no_budget(self):
        from backend.ai.aria_agent import _is_no_budget
        assert _is_no_budget("no specific budget") is True
        assert _is_no_budget("koi budget nai") is True
        assert _is_no_budget("flexible") is True
        assert _is_no_budget("no limit") is True
        assert _is_no_budget("pata nai") is True
        assert _is_no_budget("€300k-€500k") is False

    def test_parse_prefs_category(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        assert _parse_prefs_from_message("I want to buy a villa")["category"] == "sale"
        assert _parse_prefs_from_message("looking to rent a flat")["category"] == "rent"
        assert _parse_prefs_from_message("kiraya chahiye")["category"] == "rent"

    def test_parse_prefs_bedrooms(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        assert _parse_prefs_from_message("3 bedroom apartment")["bedrooms"] == 3
        assert _parse_prefs_from_message("2 bed flat")["bedrooms"] == 2

    def test_parse_prefs_urdu_property_type(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        prefs = _parse_prefs_from_message("mujhe ek ghar chahiye")
        assert prefs.get("property_type") == "house"

    def test_extract_agency_urls(self):
        from backend.ai.aria_agent import _extract_agency_urls_from_history
        msgs = _history(
            ("assistant", "Found agencies: 1. Agency A — https://agencyA.com 2. Agency B — https://agencyB.com")
        )
        urls = _extract_agency_urls_from_history(msgs)
        assert "https://agencyA.com" in urls
        assert "https://agencyB.com" in urls

    def test_extract_agency_urls_skips_social(self):
        from backend.ai.aria_agent import _extract_agency_urls_from_history
        msgs = _history(
            ("assistant", "Check https://facebook.com and https://agencyA.com")
        )
        urls = _extract_agency_urls_from_history(msgs)
        assert not any("facebook" in u for u in urls)
        assert any("agencyA" in u for u in urls)

    def test_extract_city_country(self):
        from backend.ai.aria_agent import _extract_city_country_from_history
        msgs = _history(("user", "find apartments in Valletta, Malta"))
        city, country = _extract_city_country_from_history(msgs)
        assert city == "Valletta"
        assert country == "Malta"

    def test_is_pref_reply(self):
        from backend.ai.aria_agent import _is_pref_reply
        assert _is_pref_reply("buy, 2 bedrooms, no specific budget") is True
        assert _is_pref_reply("rent apartment, flexible") is True
        assert _is_pref_reply("show all") is True

    def test_is_pref_reply_not_long_text(self):
        from backend.ai.aria_agent import _is_pref_reply
        # Very long text with "rent" in it should NOT be a pref reply
        long_msg = "rent " + "x " * 300
        assert _is_pref_reply(long_msg) is False

    # ── Price range parsing ──────────────────────────────────────────────

    def test_parse_price_range_k(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("budget €200k to €500k")
        assert p["min_price"] == 200_000
        assert p["max_price"] == 500_000

    def test_parse_price_range_dash(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("200k-500k range")
        assert p["min_price"] == 200_000
        assert p["max_price"] == 500_000

    def test_parse_price_range_and(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("between 300k and 600k")
        assert p["min_price"] == 300_000
        assert p["max_price"] == 600_000

    def test_parse_price_range_millions(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("budget 1m to 2m")
        assert p["min_price"] == 1_000_000
        assert p["max_price"] == 2_000_000

    def test_parse_price_max_only(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("under €400k please")
        assert p.get("max_price") == 400_000
        assert "min_price" not in p

    def test_parse_price_max_only_upto(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("max 1500 per month")
        assert p.get("max_price") == 1500

    def test_parse_price_min_only(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("at least €300k")
        assert p.get("min_price") == 300_000
        assert "max_price" not in p

    def test_parse_price_no_budget_no_price(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("no specific budget, flexible")
        assert "min_price" not in p
        assert "max_price" not in p

    def test_parse_price_no_extraction_on_plain(self):
        from backend.ai.aria_agent import _parse_prefs_from_message
        p = _parse_prefs_from_message("rent 3 bedroom apartment")
        assert "min_price" not in p
        assert "max_price" not in p

    def test_to_price_helper(self):
        from backend.ai.aria_agent import _to_price
        assert _to_price("200", "k") == 200_000
        assert _to_price("1.5", "m") == 1_500_000
        assert _to_price("300000", "") == 300_000
        assert _to_price("1", "M") == 1_000_000

    def test_budget_hint_includes_range_example(self):
        """The no-location hint should contain 'Min & max' prompt."""
        from backend.ai.aria_agent import _build_intent_hint
        h = _build_intent_hint("mujhe apartment chahiye")
        assert "Min & max" in h or "min & max" in h.lower()


# ═══════════════════════════════════════════════════════════════════════════
# 4. REFLECTION ENGINE
# ═══════════════════════════════════════════════════════════════════════════

class TestReflection:

    @pytest.mark.asyncio
    async def test_reflection_returns_valid_structure(self):
        """Reflection returns expected keys even on mock failure."""
        from backend.ai.aria_reflection import evaluate_response, _neutral_score

        with patch("backend.ai.aria_reflection.AsyncOpenAI") as mock_openai:
            mock_client = AsyncMock()
            mock_openai.return_value = mock_client
            mock_client.chat.completions.create.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content=json.dumps({
                    "clarity": 18,
                    "helpfulness": 16,
                    "completeness": 14,
                    "tool_usage": 17,
                    "on_brand": 15,
                    "total": 80,
                    "issues": [],
                    "correction_hint": "",
                })))]
            )

            result = await evaluate_response(
                user_message="find apartments in Dubai",
                aria_response="I found 3 agencies...",
                tools_called=["find_agencies"],
            )

        assert "total" in result
        assert "should_retry" in result
        assert "issues" in result
        assert "correction_hint" in result
        assert result["should_retry"] is False

    @pytest.mark.asyncio
    async def test_reflection_triggers_retry_on_low_score(self):
        """When total < RETRY_THRESHOLD, should_retry is True."""
        import os
        from backend.ai.aria_reflection import evaluate_response, RETRY_THRESHOLD

        os.environ["OPENAI_API_KEY"] = "sk-test-reflection"

        with patch("backend.ai.aria_reflection.AsyncOpenAI") as mock_openai:
            mock_client = AsyncMock()
            mock_openai.return_value = mock_client
            mock_client.chat.completions.create.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content=json.dumps({
                    "clarity": 5,
                    "helpfulness": 5,
                    "completeness": 5,
                    "tool_usage": 5,
                    "on_brand": 5,
                    "total": 25,
                    "issues": ["skipped clarifying questions"],
                    "correction_hint": "Ask for location before scraping",
                })))]
            )

            result = await evaluate_response(
                user_message="find properties",
                aria_response="Here are some properties...",
                tools_called=["scrape_website"],
            )

        assert result["total"] < RETRY_THRESHOLD
        assert result["should_retry"] is True
        assert result["correction_hint"] == "Ask for location before scraping"

    @pytest.mark.asyncio
    async def test_reflection_graceful_on_api_failure(self):
        """If OpenAI call fails, returns neutral score (no crash)."""
        from backend.ai.aria_reflection import evaluate_response

        with patch("backend.ai.aria_reflection.AsyncOpenAI") as mock_openai:
            mock_client = AsyncMock()
            mock_openai.return_value = mock_client
            mock_client.chat.completions.create.side_effect = Exception("API down")

            result = await evaluate_response(
                user_message="test",
                aria_response="test response",
                tools_called=[],
            )

        assert result["total"] == 75   # neutral score
        assert result["should_retry"] is False

    def test_get_score_summary_empty(self):
        """Summary returns sensible defaults when no scores recorded."""
        from backend.ai.aria_reflection import get_score_summary, _score_ring
        _score_ring.clear()
        summary = get_score_summary()
        assert summary["turns"] == 0
        assert summary["avg_total"] is None

    def test_prompt_patch_not_triggered_too_soon(self):
        """Patch does not trigger if fewer than PATCH_EVERY turns recorded."""
        from backend.ai.aria_reflection import get_prompt_patch, _score_ring, _turns_since_patch
        import backend.ai.aria_reflection as ref_mod
        _score_ring.clear()
        ref_mod._turns_since_patch = 0
        patch_text = get_prompt_patch()
        # With 0 turns, nothing fires
        assert patch_text == "" or "[AUTO-PATCH]" not in patch_text


# ═══════════════════════════════════════════════════════════════════════════
# 5. FULL AGENT TURN — MOCKED
# ═══════════════════════════════════════════════════════════════════════════

# Shared mock setup
def _mock_runner_result(text: str) -> MagicMock:
    result = MagicMock()
    result.final_output = text
    return result


@pytest.fixture
def mock_settings(monkeypatch):
    from backend import config
    monkeypatch.setattr(config.settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(config.settings, "openai_model", "gpt-4o-mini")
    monkeypatch.setattr(config.settings, "aria_max_tool_rounds", 10)


@pytest.fixture
def mock_db():
    db = AsyncMock()
    return db


class TestAriaAgentTurns:

    @pytest.mark.asyncio
    async def test_greeting_returns_immediately(self, mock_settings, mock_db):
        """Greeting short-circuits — no Runner.run call."""
        from backend.ai.aria_agent import run_aria_turn
        with patch("backend.ai.aria_agent.Runner") as mock_runner:
            text, meta, action = await run_aria_turn(
                mock_db, "hello!", _history()
            )
        mock_runner.run.assert_not_called()
        assert meta["intent"] == "greeting"
        assert action == "conversation"

    @pytest.mark.asyncio
    async def test_appreciation_returns_immediately(self, mock_settings, mock_db):
        from backend.ai.aria_agent import run_aria_turn
        with patch("backend.ai.aria_agent.Runner"):
            text, meta, action = await run_aria_turn(
                mock_db, "shukria! bohot acha", _history()
            )
        assert meta["intent"] == "appreciation"

    @pytest.mark.asyncio
    async def test_task_calls_runner(self, mock_settings, mock_db):
        """Real task message → Runner.run is called."""
        from backend.ai.aria_agent import run_aria_turn
        with patch("backend.ai.aria_agent.Runner") as mock_runner, \
             patch("backend.ai.aria_agent.evaluate_response", new_callable=AsyncMock) as mock_eval:
            mock_runner.run = AsyncMock(return_value=_mock_runner_result(
                "I found agencies in Dubai! Let me ask some questions..."
            ))
            mock_eval.return_value = {
                "total": 80, "issues": [], "correction_hint": "",
                "should_retry": False,
            }
            text, meta, action = await run_aria_turn(
                mock_db, "find apartments in Dubai, UAE", _history()
            )

        mock_runner.run.assert_called_once()
        assert meta["aria"] is True

    @pytest.mark.asyncio
    async def test_auto_correction_fires_on_low_score(self, mock_settings, mock_db):
        """Low score triggers a second Runner.run call."""
        from backend.ai.aria_agent import run_aria_turn

        call_count = 0

        async def fake_run(agent, convo, context, max_turns, run_config):
            nonlocal call_count
            call_count += 1
            return _mock_runner_result("Here are some properties...")

        reflection_calls = []

        async def fake_eval(user_message, aria_response, tools_called):
            reflection_calls.append(len(reflection_calls) + 1)
            if len(reflection_calls) == 1:
                return {
                    "total": 30, "issues": ["skipped clarifying questions"],
                    "correction_hint": "Ask for location first",
                    "should_retry": True,
                }
            return {
                "total": 82, "issues": [], "correction_hint": "", "should_retry": False,
            }

        with patch("backend.ai.aria_agent.Runner") as mock_runner, \
             patch("backend.ai.aria_agent.evaluate_response", new_callable=AsyncMock) as mock_eval:
            mock_runner.run = AsyncMock(side_effect=fake_run)
            mock_eval.side_effect = fake_eval

            text, meta, action = await run_aria_turn(
                mock_db, "find properties", _history()
            )

        # Should have run twice (original + correction)
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_max_turns_exceeded_handled(self, mock_settings, mock_db):
        """MaxTurnsExceeded exception returns graceful fallback."""
        from backend.ai.aria_agent import run_aria_turn
        from agents.exceptions import MaxTurnsExceeded

        with patch("backend.ai.aria_agent.Runner") as mock_runner, \
             patch("backend.ai.aria_agent.evaluate_response", new_callable=AsyncMock):
            mock_runner.run = AsyncMock(side_effect=MaxTurnsExceeded("too many"))

            text, meta, action = await run_aria_turn(
                mock_db, "find properties in Dubai", _history()
            )

        assert action == "aria_limit"
        assert "maximum" in text.lower()

    @pytest.mark.asyncio
    async def test_meta_contains_reflection(self, mock_settings, mock_db):
        """Meta should include reflection scores."""
        from backend.ai.aria_agent import run_aria_turn

        with patch("backend.ai.aria_agent.Runner") as mock_runner, \
             patch("backend.ai.aria_agent.evaluate_response", new_callable=AsyncMock) as mock_eval:
            mock_runner.run = AsyncMock(return_value=_mock_runner_result("Result..."))
            mock_eval.return_value = {
                "total": 88, "issues": [], "correction_hint": "", "should_retry": False,
            }
            _, meta, _ = await run_aria_turn(
                mock_db, "find villas in Malta", _history()
            )

        assert meta.get("reflection") is not None
        assert meta["reflection"]["total"] == 88

    @pytest.mark.asyncio
    async def test_urdu_task_message(self, mock_settings, mock_db):
        """Urdu message goes through full agent flow."""
        from backend.ai.aria_agent import run_aria_turn, detect_intent
        assert detect_intent("mujhe Dubai mein apartment chahiye") == "task"

        with patch("backend.ai.aria_agent.Runner") as mock_runner, \
             patch("backend.ai.aria_agent.evaluate_response", new_callable=AsyncMock) as mock_eval:
            mock_runner.run = AsyncMock(return_value=_mock_runner_result(
                "آپ کی تلاش کے لیے Dubai میں agencies..."
            ))
            mock_eval.return_value = {"total": 78, "issues": [], "correction_hint": "", "should_retry": False}

            text, meta, action = await run_aria_turn(
                mock_db, "mujhe Dubai mein apartment chahiye", _history()
            )
        mock_runner.run.assert_called_once()

    @pytest.mark.asyncio
    async def test_history_context_used(self, mock_settings, mock_db):
        """Agency URLs from history are passed correctly to intent hint."""
        from backend.ai.aria_agent import run_aria_turn, _build_intent_hint, _extract_agency_urls_from_history

        history = _history(
            ("assistant", "I found: 1. Agency One — https://agencyone.com/listings 2. Agency Two — https://agencytwo.com/listings"),
        )
        urls = _extract_agency_urls_from_history(history)
        assert len(urls) >= 1
        assert "agencyone.com" in urls[0]

    @pytest.mark.asyncio
    async def test_no_api_key_raises(self, mock_db):
        """Missing API key raises RuntimeError cleanly."""
        from backend.ai.aria_agent import run_aria_turn
        import backend.config as cfg

        original = cfg.settings.openai_api_key
        cfg.settings.openai_api_key = ""

        try:
            with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
                await run_aria_turn(mock_db, "find properties in Dubai", _history())
        finally:
            cfg.settings.openai_api_key = original


# ═══════════════════════════════════════════════════════════════════════════
# 6. EDGE CASES
# ═══════════════════════════════════════════════════════════════════════════

class TestEdgeCases:

    def test_empty_message(self):
        from backend.ai.aria_agent import detect_intent, _build_intent_hint
        assert detect_intent("") == "task"
        h = _build_intent_hint("")
        # Empty message should not crash

    def test_very_long_message(self):
        from backend.ai.aria_agent import detect_intent
        long = "find properties in Dubai " * 100
        assert detect_intent(long) == "task"

    def test_only_url_no_text(self):
        from backend.ai.aria_agent import _build_intent_hint
        h = _build_intent_hint("https://realestate.com/listings")
        assert "buy or rent" in h.lower() or "buying or renting" in h.lower()

    def test_mixed_language_english_urdu(self):
        from backend.ai.aria_agent import detect_intent, _build_intent_hint
        msg = "show me properties in Dubai, chahiye villa ya apartment"
        assert detect_intent(msg) == "task"
        h = _build_intent_hint(msg)
        assert "find_agencies" in h

    def test_budget_various_formats(self):
        from backend.ai.aria_agent import _is_no_budget
        assert _is_no_budget("open to anything") is False    # should NOT be treated as no-budget
        assert _is_no_budget("no budget") is True
        assert _is_no_budget("€200,000 to €400,000") is False

    def test_preference_without_prior_agencies(self):
        """When user gives prefs but there are no agency URLs yet."""
        from backend.ai.aria_agent import _build_intent_hint
        h = _build_intent_hint("buy, 2 bedrooms", agency_urls=[], city="Dubai", country="UAE")
        assert "scrape_website" in h
        assert "AGENCY_URL_FROM_LIST" in h  # placeholder used

    def test_next_without_second_agency(self):
        """User says 'next' but only one agency was found."""
        from backend.ai.aria_agent import _build_intent_hint
        h = _build_intent_hint("next", agency_urls=["https://only-one.com"])
        assert "NEXT agency" in h
        assert "next agency URL from conversation" in h

    def test_compare_without_seen_properties(self):
        """compare_properties hint is still emitted even with no context."""
        from backend.ai.aria_agent import _build_intent_hint
        h = _build_intent_hint("compare these two properties")
        assert "compare_properties" in h

    def test_show_all_intent(self):
        from backend.ai.aria_agent import _is_pref_reply
        assert _is_pref_reply("show all") is True
        assert _is_pref_reply("sab dikhao") is True

    def test_message_with_special_characters(self):
        from backend.ai.aria_agent import detect_intent, _build_intent_hint
        msg = "find apartments in Dubai!!!   ???  @#$"
        assert detect_intent(msg) == "task"
        # Should not crash
        _build_intent_hint(msg)

    def test_correction_hint_in_second_attempt(self):
        """Correction hint from reflection is injected into the hint."""
        from backend.ai.aria_agent import _build_intent_hint
        hint = _build_intent_hint(
            "find properties",
            correction_hint="You forgot to ask for the city before scraping"
        )
        assert "AUTO-CORRECTION" in hint
        assert "city" in hint.lower()

    def test_appreciation_in_arabic(self):
        """Appreciation detection doesn't crash on non-ASCII."""
        from backend.ai.aria_agent import detect_intent
        # These won't match but should not crash
        result = detect_intent("شكراً جزيلاً")
        assert result in ("task", "appreciation", "greeting", "compliment")

    def test_multiple_url_extraction(self):
        """Multiple agency URLs extracted correctly."""
        from backend.ai.aria_agent import _extract_agency_urls_from_history
        msgs = _history(
            ("assistant",
             "Agencies:\n1. Home Loans — https://agency1.com\n"
             "2. Quick Realty — https://agency2.com\n"
             "3. Prime Estates — https://agency3.com")
        )
        urls = _extract_agency_urls_from_history(msgs)
        assert len(urls) >= 2

    def test_extract_city_from_earlier_message(self):
        """City is extracted from earlier user message if not in latest."""
        from backend.ai.aria_agent import _extract_city_country_from_history
        msgs = _history(
            ("user", "find apartments in Valletta, Malta"),
            ("assistant", "I found these agencies..."),
            ("user", "2 bedrooms please"),
        )
        city, country = _extract_city_country_from_history(msgs)
        assert city == "Valletta"
        assert country == "Malta"
