"""
OCR Worker — traitement des jobs de type "ocr" (Smart Scan Donut).
Flux : dépile le job Redis → charge Donut → inférence → callback Next.js.
"""
import hashlib
import hmac
import json
import logging
import re

import httpx
import torch
from PIL import Image
from transformers import DonutProcessor

from app.config import AI_CALLBACK_SECRET, CALLBACK_BASE_URL, MODEL_CACHE_DIR
from app.model_manager import model_manager

logger = logging.getLogger(__name__)

DONUT_MODEL_ID = "naver-clova-ix/donut-base"
_processor: DonutProcessor | None = None


def _get_processor() -> DonutProcessor:
    global _processor
    if _processor is None:
        logger.info("Chargement du DonutProcessor (premier appel)…")
        _processor = DonutProcessor.from_pretrained(
            DONUT_MODEL_ID, cache_dir=MODEL_CACHE_DIR
        )
    return _processor


async def process_ocr_job(job: dict) -> None:
    job_id = job.get("id", "?")
    image_path = job.get("inputPath") or job.get("imagePath", "")
    callback_url = job.get(
        "callbackUrl", f"{CALLBACK_BASE_URL}/api/ai/callback"
    )

    logger.info(f"[OCR] job={job_id} image={image_path}")

    try:
        img = Image.open(image_path).convert("RGB").resize((1280, 960))
        processor = _get_processor()
        model = model_manager.get_model("ocr")

        task_prompt = "<s_cord-v2>"
        decoder_ids = processor.tokenizer(
            task_prompt, add_special_tokens=False, return_tensors="pt"
        ).input_ids.to(model.device)

        pixel_values = processor(img, return_tensors="pt").pixel_values.to(
            model.device
        )

        with torch.no_grad():
            outputs = model.generate(
                pixel_values,
                decoder_input_ids=decoder_ids,
                max_length=model.decoder.config.max_position_embeddings,
                pad_token_id=processor.tokenizer.pad_token_id,
                eos_token_id=processor.tokenizer.eos_token_id,
                use_cache=True,
                bad_words_ids=[[processor.tokenizer.unk_token_id]],
            )

        raw = processor.batch_decode(outputs)[0]
        raw = raw.replace(processor.tokenizer.eos_token, "").replace(
            processor.tokenizer.pad_token, ""
        )
        raw = re.sub(r"<.*?>", "", raw).strip()

        result = {"raw": raw, "confidence": 0.9, "job_id": job_id}
        status = "completed"

    except Exception as exc:
        logger.error(f"[OCR] job={job_id} ÉCHEC : {exc}", exc_info=True)
        result = {"error": str(exc)}
        status = "failed"

    await _send_callback(callback_url, job, result, status)


async def _send_callback(url: str, job: dict, result: dict, status: str) -> None:
    payload = {
        "jobId": job.get("id"),
        "type": job.get("type"),
        "tenantId": job.get("tenantId"),
        "missionId": job.get("missionId"),
        "status": status,
        "result": result,
    }
    body = json.dumps(payload, ensure_ascii=False)
    sig = hmac.new(
        AI_CALLBACK_SECRET.encode(), body.encode(), hashlib.sha256
    ).hexdigest()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                content=body.encode(),
                headers={
                    "Content-Type": "application/json",
                    "X-AI-Signature": sig,
                },
            )
            logger.info(f"[OCR] callback → {url} HTTP {resp.status_code}")
    except Exception as exc:
        logger.error(f"[OCR] callback vers {url} échoué : {exc}")
