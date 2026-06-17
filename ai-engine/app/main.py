"""
Pathélix AI Engine — point d'entrée FastAPI.

Démarre un consommateur Redis en arrière-plan qui traite les jobs
de la queue "ai-jobs:pending" (BRPOP).  Next.js pousse les jobs
avec LPUSH ai-jobs:pending <json>.
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI

from app.config import QUEUE_NAME, REDIS_URL
from app.routes.health import router as health_router
from app.workers.ocr_worker import process_ocr_job

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


async def _queue_consumer() -> None:
    """Boucle infinie : dépile les jobs Redis et les route vers le bon worker."""
    r = aioredis.from_url(REDIS_URL, decode_responses=True)
    queue_key = f"{QUEUE_NAME}:pending"
    logger.info(f"Queue consumer démarré — écoute sur {queue_key}")

    while True:
        try:
            item = await r.brpop(queue_key, timeout=5)
            if item is None:
                continue

            _, raw = item
            job: dict = json.loads(raw)
            job_type = job.get("type")
            job_id = job.get("id", "?")
            logger.info(f"Job reçu : id={job_id} type={job_type}")

            if job_type == "ocr":
                await process_ocr_job(job)
            else:
                logger.warning(f"Type de job non supporté : {job_type!r}")

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"Erreur consommateur : {exc}", exc_info=True)
            await asyncio.sleep(2)

    await r.aclose()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_queue_consumer())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Pathélix AI Engine", version="1.0.0", lifespan=lifespan)
app.include_router(health_router)
