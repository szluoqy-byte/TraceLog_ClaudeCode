"""
Trace log parser.

Parses incoming trace JSON data and normalizes it into the internal data model.
Supports the standard TraceSchema format and auto-generates missing IDs.
"""

import uuid
from datetime import datetime, timezone

from .models import TraceSchema, SpanSchema, EventSchema, SpanKind, SpanStatus


def _ensure_id(val: str | None) -> str:
    return val or uuid.uuid4().hex[:16]


def _parse_enum(raw: str, enum_class, fallback):
    try:
        return enum_class(raw.upper())
    except ValueError:
        return fallback


def _parse_datetime(val) -> datetime:
    if isinstance(val, datetime):
        return val
    if isinstance(val, (int, float)):
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(val, str):
        val = val.replace("Z", "+00:00")
        return datetime.fromisoformat(val)
    raise ValueError(f"Cannot parse datetime from {val}")


def parse_event(data: dict) -> EventSchema:
    return EventSchema(
        event_id=_ensure_id(data.get("event_id")),
        name=data.get("name", "event"),
        timestamp=_parse_datetime(data["timestamp"]),
        attributes=data.get("attributes", {}),
    )


def parse_span(data: dict) -> SpanSchema:
    events = [parse_event(e) for e in data.get("events", [])]

    span_kind = _parse_enum(data.get("span_kind", "CHAIN"), SpanKind, SpanKind.CHAIN)
    status = _parse_enum(data.get("status", "OK"), SpanStatus, SpanStatus.UNSET)

    return SpanSchema(
        span_id=_ensure_id(data.get("span_id")),
        parent_span_id=data.get("parent_span_id"),
        name=data.get("name", "span"),
        span_kind=span_kind,
        start_time=_parse_datetime(data["start_time"]),
        end_time=_parse_datetime(data["end_time"]) if data.get("end_time") else None,
        status=status,
        status_message=data.get("status_message"),
        attributes=data.get("attributes", {}),
        events=events,
    )


def parse_trace(data: dict) -> TraceSchema:
    """Parse a raw trace dict into a validated TraceSchema."""
    spans = [parse_span(s) for s in data.get("spans", [])]

    status = _parse_enum(data.get("status", "OK"), SpanStatus, SpanStatus.UNSET)

    # Auto-calculate total tokens from LLM spans
    total_tokens = data.get("total_tokens", 0)
    if total_tokens == 0:
        for span in spans:
            if span.span_kind == SpanKind.LLM:
                attrs = span.attributes
                total_tokens += attrs.get("llm.usage.prompt_tokens", 0)
                total_tokens += attrs.get("llm.usage.completion_tokens", 0)

    return TraceSchema(
        trace_id=_ensure_id(data.get("trace_id")),
        name=data.get("name", "Untitled Trace"),
        start_time=_parse_datetime(data["start_time"]),
        end_time=_parse_datetime(data["end_time"]) if data.get("end_time") else None,
        status=status,
        total_tokens=total_tokens,
        total_cost=data.get("total_cost", 0.0),
        metadata=data.get("metadata", {}),
        spans=spans,
    )
