import pytesseract
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "tesseract": str(pytesseract.get_tesseract_version())}
