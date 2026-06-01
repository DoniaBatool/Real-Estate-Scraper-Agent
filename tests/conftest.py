"""
Test configuration — stubs the `agents` (openai-agents) and `backend.config`
packages so tests run without a live OpenAI API key or the full SDK installed.
"""
from __future__ import annotations
import sys
import types
from unittest.mock import AsyncMock, MagicMock

# ── Stub `agents` (openai-agents SDK) ─────────────────────────────────────

class _MaxTurnsExceeded(Exception):
    pass

agents_mod = types.ModuleType("agents")
agents_mod.Agent = MagicMock(name="Agent")
agents_mod.ModelSettings = MagicMock(name="ModelSettings")
agents_mod.RunConfig = MagicMock(name="RunConfig")
agents_mod.Runner = MagicMock(name="Runner")
agents_mod.Runner.run = AsyncMock()
agents_mod.function_tool = lambda f: f          # passthrough decorator
agents_mod.RunContextWrapper = MagicMock(name="RunContextWrapper")

agents_exceptions = types.ModuleType("agents.exceptions")
agents_exceptions.MaxTurnsExceeded = _MaxTurnsExceeded
agents_mod.exceptions = agents_exceptions

sys.modules["agents"] = agents_mod
sys.modules["agents.exceptions"] = agents_exceptions

# ── Stub `backend.config` ──────────────────────────────────────────────────

config_mod = types.ModuleType("backend.config")

class _Settings:
    openai_api_key: str = "sk-test-key"
    openai_model: str = "gpt-4o-mini"
    aria_max_tool_rounds: int = 10
    frontend_url: str = "http://localhost:3000"

config_mod.settings = _Settings()
sys.modules["backend.config"] = config_mod

# ── Stub `backend.ai.aria_prompts` ─────────────────────────────────────────

prompts_mod = types.ModuleType("backend.ai.aria_prompts")
prompts_mod.AGENT_SYSTEM_PROMPT = "You are ARIA, a real estate agent."
prompts_mod.TOOL_STATUS_LABELS = {
    "find_agencies": "🏢 Finding agencies...",
    "scrape_website": "🔗 Scraping website...",
    "live_search_properties": "🌐 Searching...",
    "web_search": "🔎 Searching web...",
    "compare_properties": "📊 Comparing...",
    "market_insights": "💡 Analyzing...",
    "get_property_details": "🏠 Fetching details...",
}
sys.modules["backend.ai.aria_prompts"] = prompts_mod

# ── Stub `backend.ai.aria_tool_runner` ─────────────────────────────────────

runner_mod = types.ModuleType("backend.ai.aria_tool_runner")
runner_mod.execute_aria_tool = AsyncMock(return_value='{"properties": []}')
sys.modules["backend.ai.aria_tool_runner"] = runner_mod

# ── Stub heavy deps (sqlalchemy, httpx, openai) ───────────────────────────

for mod_name in [
    "sqlalchemy", "sqlalchemy.ext", "sqlalchemy.ext.asyncio",
    "httpx", "openai",
]:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = types.ModuleType(mod_name)

# sqlalchemy.text stub
_sa = sys.modules["sqlalchemy"]
_sa.text = MagicMock(name="text")

# AsyncSession stub
_sa_async = sys.modules.get("sqlalchemy.ext.asyncio") or types.ModuleType("sqlalchemy.ext.asyncio")
_sa_async.AsyncSession = MagicMock(name="AsyncSession")
sys.modules["sqlalchemy.ext.asyncio"] = _sa_async

# AsyncOpenAI stub
_openai = sys.modules.get("openai") or types.ModuleType("openai")
_openai.AsyncOpenAI = MagicMock(name="AsyncOpenAI")
sys.modules["openai"] = _openai

# ── Stub backend.memory.user_memory ───────────────────────────────────────

memory_mod = types.ModuleType("backend.memory")
user_memory_mod = types.ModuleType("backend.memory.user_memory")
user_memory_mod.build_personalized_context = AsyncMock(return_value=("", {}))
user_memory_mod.update_user_memory = AsyncMock(return_value=None)
sys.modules["backend.memory"] = memory_mod
sys.modules["backend.memory.user_memory"] = user_memory_mod

# ── pytest-asyncio mode ────────────────────────────────────────────────────
import pytest

def pytest_configure(config):
    config.addinivalue_line("markers", "asyncio: mark test as async")


# Make pytest-asyncio work in auto mode
try:
    import pytest_asyncio  # noqa: F401
except ImportError:
    pass
