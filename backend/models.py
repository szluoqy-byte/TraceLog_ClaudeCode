"""
Data models based on OpenTelemetry Generative AI Semantic Conventions.

Core concepts:
- Trace: A complete Agent execution session
- Span: A unit of work (LLM call, tool call, agent step, chain)
- Event: A discrete occurrence within a span
"""

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from sqlalchemy import (
    Column, String, Text, Float, Integer, ForeignKey, JSON, DateTime, Index
)
from sqlalchemy.orm import relationship
from pydantic import BaseModel, Field

from .database import Base


# ─── SQLAlchemy ORM Models ───────────────────────────────────────────────────


class TraceRecord(Base):
    __tablename__ = "traces"

    trace_id = Column(String(64), primary_key=True)
    name = Column(String(256), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String(32), default="OK")  # OK, ERROR, UNSET
    total_tokens = Column(Integer, default=0)
    total_cost = Column(Float, default=0.0)
    metadata_ = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    spans = relationship("SpanRecord", back_populates="trace", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_traces_created_at", "created_at"),
        Index("ix_traces_status", "status"),
    )


class SpanRecord(Base):
    __tablename__ = "spans"

    span_id = Column(String(64), primary_key=True)
    trace_id = Column(String(64), ForeignKey("traces.trace_id", ondelete="CASCADE"), nullable=False)
    parent_span_id = Column(String(64), nullable=True)
    name = Column(String(256), nullable=False)
    span_kind = Column(String(32), nullable=False)  # AGENT, LLM, TOOL, CHAIN, RETRIEVER
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String(32), default="OK")
    status_message = Column(Text, nullable=True)
    attributes = Column(JSON, default=dict)

    trace = relationship("TraceRecord", back_populates="spans")
    events = relationship("EventRecord", back_populates="span", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_spans_trace_id", "trace_id"),
        Index("ix_spans_parent_span_id", "parent_span_id"),
        Index("ix_spans_span_kind", "span_kind"),
    )


class EventRecord(Base):
    __tablename__ = "events"

    event_id = Column(String(64), primary_key=True)
    span_id = Column(String(64), ForeignKey("spans.span_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(256), nullable=False)
    timestamp = Column(DateTime, nullable=False)
    attributes = Column(JSON, default=dict)

    span = relationship("SpanRecord", back_populates="events")

    __table_args__ = (
        Index("ix_events_span_id", "span_id"),
    )


# ─── Pydantic Schemas ────────────────────────────────────────────────────────


class SpanKind(str, Enum):
    AGENT = "AGENT"
    LLM = "LLM"
    TOOL = "TOOL"
    CHAIN = "CHAIN"
    RETRIEVER = "RETRIEVER"


class SpanStatus(str, Enum):
    OK = "OK"
    ERROR = "ERROR"
    UNSET = "UNSET"


class EventSchema(BaseModel):
    event_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:16])
    name: str
    timestamp: datetime
    attributes: dict = Field(default_factory=dict)


class SpanSchema(BaseModel):
    span_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:16])
    parent_span_id: Optional[str] = None
    name: str
    span_kind: SpanKind
    start_time: datetime
    end_time: Optional[datetime] = None
    status: SpanStatus = SpanStatus.OK
    status_message: Optional[str] = None
    attributes: dict = Field(default_factory=dict)
    events: list[EventSchema] = Field(default_factory=list)


class TraceSchema(BaseModel):
    trace_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:16])
    name: str
    start_time: datetime
    end_time: Optional[datetime] = None
    status: SpanStatus = SpanStatus.OK
    total_tokens: int = 0
    total_cost: float = 0.0
    metadata: dict = Field(default_factory=dict)
    spans: list[SpanSchema] = Field(default_factory=list)


# ─── Response Schemas ─────────────────────────────────────────────────────────


class TraceListItem(BaseModel):
    trace_id: str
    name: str
    start_time: datetime
    end_time: Optional[datetime]
    status: str
    total_tokens: int
    total_cost: float
    span_count: int
    duration_ms: Optional[float]
    metadata: dict

    model_config = {"from_attributes": True}


class TraceDetail(BaseModel):
    trace_id: str
    name: str
    start_time: datetime
    end_time: Optional[datetime]
    status: str
    total_tokens: int
    total_cost: float
    metadata: dict
    spans: list[dict]

    model_config = {"from_attributes": True}


class TraceListResponse(BaseModel):
    total: int
    traces: list[TraceListItem]
