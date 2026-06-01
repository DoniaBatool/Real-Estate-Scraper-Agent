"""
Database models — only chat history is persisted.
Property data is fetched live from agency websites via Stagehand.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from backend.database.connection import Base


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title      = Column(Text, nullable=False, default="New Chat")
    archived   = Column(Boolean, default=False, nullable=False)
    # ── Session state: stores preferences, agency list, search phase ──────
    # This is the single source of truth for what the user has asked for.
    # Avoids fragile regex re-parsing of conversation history every turn.
    state_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    messages   = relationship("ChatMessage", back_populates="thread", cascade="all, delete-orphan")
    summaries  = relationship("ChatSummary",  back_populates="thread", cascade="all, delete-orphan")
    tool_runs  = relationship("ChatToolRun",  back_populates="thread", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id  = Column(UUID(as_uuid=True), ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False)
    role       = Column(String, nullable=False)   # user | assistant
    content    = Column(Text, nullable=False)
    meta_json  = Column(Text)                     # JSON blob for tool traces, properties, etc.
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    thread = relationship("ChatThread", back_populates="messages")


class ChatSummary(Base):
    __tablename__ = "chat_summaries"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id     = Column(UUID(as_uuid=True), ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False)
    summary       = Column(Text, nullable=False)
    message_count = Column(Integer, default=0, nullable=False)
    created_at    = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    thread = relationship("ChatThread", back_populates="summaries")


class ChatToolRun(Base):
    __tablename__ = "chat_tool_runs"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id      = Column(UUID(as_uuid=True), ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False)
    message_id     = Column(UUID(as_uuid=True), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True)
    tool_name      = Column(String, nullable=False)
    tool_args_json = Column(Text)
    rationale      = Column(Text)
    status         = Column(String, nullable=False, default="started")
    output_json    = Column(Text)
    created_at     = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    thread = relationship("ChatThread", back_populates="tool_runs")
