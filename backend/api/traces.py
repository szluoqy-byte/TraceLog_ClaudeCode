"""Trace API routes."""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from ..database import get_db
from ..models import (
    TraceRecord, SpanRecord, EventRecord,
    TraceSchema, TraceListItem, TraceListResponse, TraceDetail,
)
from ..parser import parse_trace

router = APIRouter(prefix="/api/v1/traces", tags=["traces"])


def _save_trace(db: Session, trace: TraceSchema) -> TraceRecord:
    """Persist a parsed trace to the database."""
    # Check for duplicate
    existing = db.query(TraceRecord).filter(TraceRecord.trace_id == trace.trace_id).first()
    if existing:
        # Delete old one and replace
        db.delete(existing)
        db.flush()

    record = TraceRecord(
        trace_id=trace.trace_id,
        name=trace.name,
        start_time=trace.start_time,
        end_time=trace.end_time,
        status=trace.status.value,
        total_tokens=trace.total_tokens,
        total_cost=trace.total_cost,
        metadata_=trace.metadata,
    )
    db.add(record)

    for span in trace.spans:
        span_record = SpanRecord(
            span_id=span.span_id,
            trace_id=trace.trace_id,
            parent_span_id=span.parent_span_id,
            name=span.name,
            span_kind=span.span_kind.value,
            start_time=span.start_time,
            end_time=span.end_time,
            status=span.status.value,
            status_message=span.status_message,
            attributes=span.attributes,
        )
        db.add(span_record)

        for event in span.events:
            event_record = EventRecord(
                event_id=event.event_id,
                span_id=span.span_id,
                name=event.name,
                timestamp=event.timestamp,
                attributes=event.attributes,
            )
            db.add(event_record)

    db.commit()
    db.refresh(record)
    return record


@router.post("", status_code=201)
def ingest_trace(data: dict, db: Session = Depends(get_db)):
    """Ingest a single trace via JSON body."""
    try:
        trace = parse_trace(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid trace data: {e}")
    record = _save_trace(db, trace)
    return {"trace_id": record.trace_id, "message": "Trace ingested successfully"}


@router.post("/upload", status_code=201)
async def upload_trace(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a trace JSON file."""
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    # Support single trace or array of traces
    results = []
    items = data if isinstance(data, list) else [data]
    for item in items:
        try:
            trace = parse_trace(item)
            record = _save_trace(db, trace)
            results.append({"trace_id": record.trace_id, "status": "ok"})
        except Exception as e:
            results.append({"error": str(e), "status": "failed"})

    return {"results": results, "total": len(results)}


@router.get("", response_model=TraceListResponse)
def list_traces(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List traces with pagination and optional filters."""
    query = db.query(TraceRecord)

    if status:
        query = query.filter(TraceRecord.status == status.upper())
    if search:
        query = query.filter(TraceRecord.name.ilike(f"%{search}%"))

    total = query.count()
    records = query.order_by(desc(TraceRecord.created_at)).offset(offset).limit(limit).all()

    traces = []
    for r in records:
        span_count = db.query(func.count(SpanRecord.span_id)).filter(
            SpanRecord.trace_id == r.trace_id
        ).scalar()

        duration_ms = None
        if r.start_time and r.end_time:
            duration_ms = (r.end_time - r.start_time).total_seconds() * 1000

        traces.append(TraceListItem(
            trace_id=r.trace_id,
            name=r.name,
            start_time=r.start_time,
            end_time=r.end_time,
            status=r.status,
            total_tokens=r.total_tokens,
            total_cost=r.total_cost,
            span_count=span_count,
            duration_ms=duration_ms,
            metadata=r.metadata_ or {},
        ))

    return TraceListResponse(total=total, traces=traces)


@router.get("/{trace_id}", response_model=TraceDetail)
def get_trace(trace_id: str, db: Session = Depends(get_db)):
    """Get full trace detail including all spans and events."""
    record = db.query(TraceRecord).filter(TraceRecord.trace_id == trace_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Trace not found")

    spans_raw = db.query(SpanRecord).filter(SpanRecord.trace_id == trace_id).all()

    spans = []
    for s in spans_raw:
        events = db.query(EventRecord).filter(EventRecord.span_id == s.span_id).all()
        duration_ms = None
        if s.start_time and s.end_time:
            duration_ms = (s.end_time - s.start_time).total_seconds() * 1000

        spans.append({
            "span_id": s.span_id,
            "parent_span_id": s.parent_span_id,
            "name": s.name,
            "span_kind": s.span_kind,
            "start_time": s.start_time.isoformat(),
            "end_time": s.end_time.isoformat() if s.end_time else None,
            "duration_ms": duration_ms,
            "status": s.status,
            "status_message": s.status_message,
            "attributes": s.attributes or {},
            "events": [
                {
                    "event_id": e.event_id,
                    "name": e.name,
                    "timestamp": e.timestamp.isoformat(),
                    "attributes": e.attributes or {},
                }
                for e in events
            ],
        })

    return TraceDetail(
        trace_id=record.trace_id,
        name=record.name,
        start_time=record.start_time,
        end_time=record.end_time,
        status=record.status,
        total_tokens=record.total_tokens,
        total_cost=record.total_cost,
        metadata=record.metadata_ or {},
        spans=spans,
    )


@router.delete("/{trace_id}")
def delete_trace(trace_id: str, db: Session = Depends(get_db)):
    """Delete a trace and all its spans/events."""
    record = db.query(TraceRecord).filter(TraceRecord.trace_id == trace_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Trace not found")
    db.delete(record)
    db.commit()
    return {"message": "Trace deleted"}
