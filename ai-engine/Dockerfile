# ─── ai-engine/Dockerfile — FastAPI + Donut OCR (CUDA 12.1 / Ubuntu 22.04) ───
#
# Base CUDA runtime — les librairies cuBLAS/cuDNN sont embarquées dans torch.
# Ne nécessite PAS cuda-devel sur l'hôte ; le nvidia-container-toolkit suffit.

FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

# Dépendances système
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    libgl1 \
    libglib2.0-0 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installer les dépendances Python d'abord (layer cacheable)
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier le code applicatif
COPY app/ app/

# Créer le dossier models (peuplé via volume Docker au runtime)
RUN mkdir -p models uploads

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
