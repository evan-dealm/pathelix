import os

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
# Base URL of the Next.js app the results are posted back to (/api/ai/callback).
CALLBACK_BASE_URL: str = os.getenv("CALLBACK_BASE_URL", "http://localhost:3000")
AI_CALLBACK_SECRET: str = os.getenv("AI_CALLBACK_SECRET", "")
OCR_LANGS: str = os.getenv("OCR_LANGS", "fra+eng")

# Shared with src/lib/ocr/engine.ts.
QUEUE_KEY: str = "ai-jobs:pending"
HEARTBEAT_KEY: str = "ai-engine:heartbeat"

if len(AI_CALLBACK_SECRET) < 32:
    raise RuntimeError("AI_CALLBACK_SECRET must be set (32+ chars, same value as the app)")
