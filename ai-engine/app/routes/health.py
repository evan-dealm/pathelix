from fastapi import APIRouter
from app.model_manager import model_manager

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "gpu": model_manager.vram_status(),
    }
