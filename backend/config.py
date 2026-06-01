from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        extra="ignore",
        env_ignore_empty=True,
    )

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Supabase — only for chat history now
    supabase_url: str = ""
    supabase_key: str = ""
    database_url: str = ""

    # Browserbase — cloud browsers for Stagehand
    browserbase_api_key: str = ""
    browserbase_project_id: str = ""

    # Frontend URL — ARIA Python calls Next.js Stagehand routes
    # Local dev: http://localhost:3000  |  Production: https://your-app.vercel.app
    frontend_url: str = "http://localhost:3000"

    # Web search
    tavily_api_key: str = ""

    # Apify — used to discover real estate agency websites via Google Search
    apify_api_key: str = ""

    # ARIA config
    use_aria_agent: bool = True
    aria_max_tool_rounds: int = 10


load_dotenv(_ENV_FILE)
settings = Settings()
