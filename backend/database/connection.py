from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase
from backend.config import settings


def _build_url() -> str:
    url = settings.database_url
    if not url:
        return ""
    return url.replace("postgresql://", "postgresql+asyncpg://").replace(
        "postgres://", "postgresql+asyncpg://"
    )


class Base(DeclarativeBase):
    pass


_engine = None
_session_factory = None


def _get_engine():
    global _engine, _session_factory
    if _engine is None:
        db_url = _build_url()
        if not db_url:
            raise RuntimeError(
                "DATABASE_URL is not set. Add it to backend/.env before starting the server."
            )
        _engine = create_async_engine(db_url, echo=False, pool_pre_ping=True)
        _session_factory = async_sessionmaker(
            _engine, class_=AsyncSession, expire_on_commit=False
        )
    return _engine, _session_factory


async def get_db():
    _, factory = _get_engine()
    async with factory() as session:
        yield session


async def init_db() -> None:
    engine, _ = _get_engine()
    # Import models so SQLAlchemy metadata includes all tables.
    from backend.database import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Backward-compatible schema guard for older deployments.
        await conn.execute(
            text("ALTER TABLE agencies ADD COLUMN IF NOT EXISTS property_categories TEXT[]")
        )
        # conversation_embeddings / legacy DB column guards (see add_memory_tables.sql)
        await conn.execute(
            text(
                """
                DO $guard$
                BEGIN
                  IF EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name = 'conversation_embeddings'
                  ) THEN
                    ALTER TABLE conversation_embeddings
                      ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT '';
                    ALTER TABLE conversation_embeddings
                      ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
                    ALTER TABLE conversation_embeddings
                      ADD COLUMN IF NOT EXISTS message TEXT DEFAULT '';
                  END IF;
                END $guard$;
                """
            )
        )
