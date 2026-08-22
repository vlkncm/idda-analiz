from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.logging import configure_logging
from app.scheduler import start_scheduler


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    scheduler = start_scheduler()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Ücretsiz Futbol Olasılık Motoru", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "phase": "22"}
