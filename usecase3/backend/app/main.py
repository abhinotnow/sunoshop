"""Oriel backend: FastAPI app. Run from the repo root:

    uvicorn backend.app.main:app --host 0.0.0.0 --port 8000

If frontend/dist exists (after `npm run build`), the app is also served from http://localhost:8000,
so ONE tunnel to port 8000 is enough for the iPhone.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .routers import ask, health, read, speech
from .services import anuvaad, gemini
from .settings import FRONTEND_DIST, ROOT, get_settings

FRONTEND_PUBLIC = ROOT / "frontend" / "public"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("oriel")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    log.info("Gemini: %s (reader %s, arbiter %s)", "configured" if gemini.configured() else "MISSING KEY",
             s.reader_model, s.arbiter_model)
    st = anuvaad.status()
    for kind, models in st.items():
        ready = [k for k, ok in models.items() if ok]
        log.info("AnuvaadHub %s: %s", kind.upper(), ", ".join(ready) if ready else "none configured")
    yield
    await anuvaad.client().aclose()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Oriel", version="1.0.0", lifespan=lifespan,
                  description="Zero-tap city-sign reading in Telugu, Hindi and English.")
    app.add_middleware(CORSMiddleware, allow_origins=list(s.cors_origins), allow_methods=["*"], allow_headers=["*"])
    for r in (health.router, read.router, ask.router, speech.router):
        app.include_router(r, prefix="/api")

    if FRONTEND_DIST.exists():
        assets = FRONTEND_DIST / "assets"
        if assets.exists():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            # frontend/public is checked too, so guidance clips generated AFTER `npm run build` are served.
            for base in (FRONTEND_DIST, FRONTEND_PUBLIC):
                target = (base / path).resolve()
                if path and target.is_file() and base.resolve() in target.parents:
                    return FileResponse(target)
            if path.startswith(("api/", "audio/", "assets/")):
                return JSONResponse({"error": "not found"}, status_code=404)
            return FileResponse(FRONTEND_DIST / "index.html")

    return app


app = create_app()
