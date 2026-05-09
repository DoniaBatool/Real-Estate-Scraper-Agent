from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Always resolve .env relative to this file (backend/.env)
_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Apify
    apify_api_token: str = ""

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""
    database_url: str = ""

    # Upstash Redis
    redis_url: str = ""
    tavily_api_key: str = ""

    # 2captcha
    captcha_api_key: str = ""

    # Proxy (Level 3 — optional)
    proxy_username: str = ""
    proxy_password: str = ""
    proxy_host: str = ""
    proxy_port: str = ""

    # Multi-page scrape: max individual property detail pages per agency (after listings index)
    scrape_max_property_detail_pages: int = 50

    # ARIA chat agent (OpenAI tool loop); falls back to rule-based chat if disabled or on error
    use_aria_agent: bool = True
    aria_max_tool_rounds: int = 8


settings = Settings()
