from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
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
