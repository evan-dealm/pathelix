"""
OCR worker — reads a weighing-ticket photo with Tesseract (fra+eng) and reports the text it saw,
line by line with Tesseract's own confidence. Figures (net, gross, tare, ticket number) are NOT
interpreted here: the Next.js app does it (src/lib/ocr/ticket.ts) so the checks live in one
tested place, and a person always confirms the result.

Job contract (src/lib/ocr/engine.ts):
  in : {"id", "type": "ocr", "tenantId", "missionId", "image": <base64>, "filename"}
  out: POST /api/ai/callback, HMAC-SHA256 of the body in X-AI-Signature,
       {"jobId", "status": "done"|"failed", "result": {"text", "lines": [{"text","conf"}], "meanConfidence"}, "error"}
"""
import base64
import binascii
import hashlib
import hmac
import io
import json
import logging

import httpx
import pytesseract
from PIL import Image, ImageOps

from app.config import AI_CALLBACK_SECRET, CALLBACK_BASE_URL, OCR_LANGS

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 40_000_000  # decompression-bomb guard


def _prepare(data: bytes) -> Image.Image:
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)  # phone photos carry their rotation in EXIF
    img = ImageOps.grayscale(img)
    # Tesseract reads best around 30 px per text line: upscale small photos, cap huge ones.
    w, h = img.size
    scale = 2.0 if max(w, h) < 1500 else (2500 / max(w, h) if max(w, h) > 4000 else 1.0)
    if scale != 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return ImageOps.autocontrast(img)


def read_ticket(data: bytes) -> dict:
    """Text of the ticket, grouped in lines with their mean word confidence (0–1)."""
    img = _prepare(data)
    d = pytesseract.image_to_data(img, lang=OCR_LANGS, config="--psm 6", output_type=pytesseract.Output.DICT)
    lines: dict[tuple, dict] = {}
    for i, word in enumerate(d["text"]):
        word = (word or "").strip()
        conf = float(d["conf"][i])
        if not word or conf < 0:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        line = lines.setdefault(key, {"words": [], "confs": []})
        line["words"].append(word)
        line["confs"].append(conf / 100.0)
    out = [
        {"text": " ".join(l["words"]), "conf": round(sum(l["confs"]) / len(l["confs"]), 3)}
        for _, l in sorted(lines.items())
    ]
    all_confs = [c for l in lines.values() for c in l["confs"]]
    return {
        "text": "\n".join(l["text"] for l in out),
        "lines": out,
        "meanConfidence": round(sum(all_confs) / len(all_confs), 3) if all_confs else 0.0,
    }


async def process_ocr_job(job: dict) -> None:
    job_id = job.get("id")
    if not isinstance(job_id, str):
        logger.error("[OCR] job without id — dropped")
        return
    try:
        data = base64.b64decode(job.get("image") or "", validate=True)
        if not data or len(data) > MAX_IMAGE_BYTES:
            raise ValueError("image missing or too large")
        result, status, error = read_ticket(data), "done", None
        logger.info(f"[OCR] job={job_id} lines={len(result['lines'])} mean={result['meanConfidence']}")
    except (binascii.Error, ValueError, OSError, pytesseract.TesseractError) as exc:
        logger.error(f"[OCR] job={job_id} failed: {exc}")
        result, status, error = None, "failed", str(exc)[:300]
    await send_callback(job_id, status, result, error)


def sign(body: bytes) -> str:
    return hmac.new(AI_CALLBACK_SECRET.encode(), body, hashlib.sha256).hexdigest()


async def send_callback(job_id: str, status: str, result: dict | None, error: str | None) -> None:
    payload = {"jobId": job_id, "status": status, "result": result, "error": error}
    body = json.dumps(payload, ensure_ascii=False).encode()
    url = f"{CALLBACK_BASE_URL.rstrip('/')}/api/ai/callback"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, content=body, headers={"Content-Type": "application/json", "X-AI-Signature": sign(body)})
            if resp.status_code < 500:
                logger.info(f"[OCR] callback job={job_id} HTTP {resp.status_code}")
                return
        except httpx.HTTPError as exc:
            logger.warning(f"[OCR] callback job={job_id} attempt {attempt + 1}: {exc}")
    logger.error(f"[OCR] callback job={job_id} gave up (the job expires on the app side)")
