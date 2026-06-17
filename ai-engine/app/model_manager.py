"""
VRAM Arbiter — un seul modèle en VRAM à la fois.
Swap séquentiel : décharge le modèle actuel avant d'en charger un nouveau.
Source : AI_ROADMAP.md §10 — Gestion de la VRAM.
"""
import gc
import os
from threading import Lock

import torch


class ModelManager:
    def __init__(self):
        self.current_model: str | None = None
        self.models: dict = {}          # modèles CPU (warm cache)
        self.gpu_model = None           # modèle actuellement en VRAM
        self.lock = Lock()

    def get_model(self, model_name: str):
        with self.lock:
            if self.current_model == model_name and self.gpu_model is not None:
                return self.gpu_model

            # Décharger le modèle actuel de la VRAM
            if self.gpu_model is not None:
                self.gpu_model.cpu()
                torch.cuda.empty_cache()
                gc.collect()

            model = self._load(model_name)
            self.gpu_model = model.cuda() if torch.cuda.is_available() else model
            self.current_model = model_name
            return self.gpu_model

    def _load(self, model_name: str):
        """Charge le modèle en RAM CPU (télécharge depuis HuggingFace si absent)."""
        from transformers import VisionEncoderDecoderModel

        cache_dir = os.getenv("MODEL_CACHE_DIR", "/app/models")

        if model_name == "ocr":
            cpu_key = "ocr_model_cpu"
            if cpu_key not in self.models:
                self.models[cpu_key] = VisionEncoderDecoderModel.from_pretrained(
                    "naver-clova-ix/donut-base",
                    cache_dir=cache_dir,
                )
            return self.models[cpu_key]

        raise ValueError(f"Modèle inconnu : {model_name!r}")

    def vram_status(self) -> dict:
        if not torch.cuda.is_available():
            return {"available": False, "current_model": None}
        return {
            "available": True,
            "current_model": self.current_model,
            "vram_used_mb": round(torch.cuda.memory_allocated() / 1024 ** 2),
            "vram_total_mb": round(
                torch.cuda.get_device_properties(0).total_memory / 1024 ** 2
            ),
        }


model_manager = ModelManager()
