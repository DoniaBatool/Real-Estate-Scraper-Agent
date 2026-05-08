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
