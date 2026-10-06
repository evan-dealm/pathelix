"""
Pathélix AI engine — FastAPI process that consumes the OCR queue.

The app LPUSHes jobs on `ai-jobs:pending` (src/lib/ocr/engine.ts); this process BRPOPs them and
refreshes `ai-engine:heartbeat` (TTL 60 s) while it runs. The app only queues images while that
heartbeat exists: when the engine is down, drivers get the manual weight form straight away.
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI

from app.config import HEARTBEAT_KEY, QUEUE_KEY, REDIS_URL
from app.routes.health import router as health_router
from app.workers.ocr_worker import process_ocr_job

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger(__name__)


async def _heartbeat(r: aioredis.Redis) -> None:
    while True:
        try:
            await r.set(HEARTBEAT_KEY, "1", ex=60)
        except Exception as exc:  # Redis briefly unavailable: retry next tick
            logger.warning(f"heartbeat failed: {exc}")
        await asyncio.sleep(20)


async def _queue_consumer(r: aioredis.Redis) -> None:
    logger.info(f"Queue consumer listening on {QUEUE_KEY}")
    while True:
        try:
            item = await r.brpop(QUEUE_KEY, timeout=5)
            if item is None:
                continue
            job = json.loads(item[1])
            if job.get("type") == "ocr":
                await process_ocr_job(job)
            else:
                logger.warning(f"Unsupported job type: {job.get('type')!r}")
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"Consumer error: {exc}", exc_info=True)
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    r = aioredis.from_url(REDIS_URL, decode_responses=True)
    tasks = [asyncio.create_task(_heartbeat(r)), asyncio.create_task(_queue_consumer(r))]
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    # Stop advertising the engine at once rather than in up to 60 s.
    try:
        await r.delete(HEARTBEAT_KEY)
    finally:
        await r.aclose()


app = FastAPI(title="Pathélix AI Engine", version="2.0.0", lifespan=lifespan)
app.include_router(health_router)
