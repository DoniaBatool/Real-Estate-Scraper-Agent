import uuid
from datetime import datetime, date
from sqlalchemy import (
    Column, String, Float, Integer, Text, ARRAY,
    ForeignKey, DateTime, Date, Boolean,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from backend.database.connection import Base


class Agency(Base):
    __tablename__ = "agencies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    scraped_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    name = Column(Text, nullable=False)
    owner_name = Column(Text)
    founded_year = Column(Integer)
    description = Column(Text)
    logo_url = Column(Text)
    website_url = Column(Text, unique=True, nullable=False)

    email = Column(ARRAY(Text))
    phone = Column(ARRAY(Text))
    whatsapp = Column(Text)
    facebook_url = Column(Text)
    instagram_url = Column(Text)
    linkedin_url = Column(Text)
    twitter_url = Column(Text)

    google_rating = Column(Float)
    review_count = Column(Integer)
    specialization = Column(Text)
    price_range_min = Column(Float)
    price_range_max = Column(Float)
    currency = Column(Text, default="EUR")
    total_listings = Column(Integer)
    property_categories = Column(ARRAY(Text))

    city = Column(Text)
    country = Column(Text)
    scrape_level = Column(Integer)
    scrape_status = Column(Text, default="pending")

    properties = relationship("Property", back_populates="agency", cascade="all, delete-orphan")


class Property(Base):
    __tablename__ = "properties"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agency_id = Column(UUID(as_uuid=True), ForeignKey("agencies.id", ondelete="CASCADE"))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    title = Column(Text)
    property_type = Column(Text)
    category = Column(Text)
    description = Column(Text)
    images = Column(ARRAY(Text))

    bedrooms = Column(Integer)
    bathroom_count = Column(Integer)
    bedroom_sqm = Column(Float)
    bathroom_sqm = Column(Float)
    total_sqm = Column(Float)
    plot_sqm = Column(Float)

    furnished = Column(Text)
    floor_number = Column(Integer)
    total_floors = Column(Integer)
    year_built = Column(Integer)
    condition = Column(Text)
    energy_rating = Column(Text)
    virtual_tour_url = Column(Text)
    listing_reference = Column(Text)
    full_address = Column(Text)

    price = Column(Float)
    price_per_sqm = Column(Float)
    currency = Column(Text, default="EUR")

    locality = Column(Text)
    district = Column(Text)
    city = Column(Text)
    country = Column(Text)
    latitude = Column(Float)
    longitude = Column(Float)

    listing_date = Column(Date)
    amenities = Column(ARRAY(Text))
    listing_url = Column(Text)

    agency = relationship("Agency", back_populates="properties")


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    title = Column(Text, nullable=False, default="New Chat")
    archived = Column(Boolean, default=False, nullable=False)

    messages = relationship("ChatMessage", back_populates="thread", cascade="all, delete-orphan")
    summaries = relationship("ChatSummary", back_populates="thread", cascade="all, delete-orphan")
    tool_runs = relationship("ChatToolRun", back_populates="thread", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)  # user | assistant | system
    content = Column(Text, nullable=False)
    meta_json = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    thread = relationship("ChatThread", back_populates="messages")


class ChatSummary(Base):
    __tablename__ = "chat_summaries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False)
    summary = Column(Text, nullable=False)
    message_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    thread = relationship("ChatThread", back_populates="summaries")


class ChatToolRun(Base):
    __tablename__ = "chat_tool_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False)
    message_id = Column(UUID(as_uuid=True), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True)
    tool_name = Column(String, nullable=False)
    tool_args_json = Column(Text)
    rationale = Column(Text)
    status = Column(String, nullable=False, default="started")
    output_json = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    thread = relationship("ChatThread", back_populates="tool_runs")
