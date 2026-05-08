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

    # 2captcha
    captcha_api_key: str = ""

    # Proxy (Level 3 — optional)
    proxy_username: str = ""
    proxy_password: str = ""
    proxy_host: str = ""
    proxy_port: str = ""


settings = Settings()
