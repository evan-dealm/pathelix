import os

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
CALLBACK_BASE_URL: str = os.getenv("CALLBACK_BASE_URL", "http://localhost:3000")
AI_CALLBACK_SECRET: str = os.getenv("AI_CALLBACK_SECRET", "")
MODEL_CACHE_DIR: str = os.getenv("MODEL_CACHE_DIR", "/app/models")

# Nom de la queue Redis (clé liste : ai-jobs:pending)
QUEUE_NAME: str = "ai-jobs"
