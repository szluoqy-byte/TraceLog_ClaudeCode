"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .database import init_db
from .api.traces import router as traces_router

app = FastAPI(
    title="TraceLog - AI Agent Observability Platform",
    version="0.1.0",
    description="Record, analyze and visualize AI Agent execution traces.",
)

app.include_router(traces_router)


@app.on_event("startup")
def startup():
    init_db()


# Serve frontend static files
app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse("frontend/index.html")
