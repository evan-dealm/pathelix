"""
Engine check on a synthetic ticket (run in the image: `docker run --rm -e AI_CALLBACK_SECRET=... <img> python -m tests.test_ocr`).
Renders a weighbridge ticket, reads it back with Tesseract, and checks the figures the app parses
are in the text with a usable confidence — the real path, no mock.
"""
import base64
import io
import os
import sys

os.environ.setdefault("AI_CALLBACK_SECRET", "x" * 32)

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from app.workers.ocr_worker import read_ticket  # noqa: E402

TICKET = [
    "CENTRE DE TRI DU GRESIVAUDAN",
    "Ticket N° 2026-04812",
    "Date : 14/03/2026  10:42",
    "Immat : GH-482-KT",
    "Pesee 1 (brut)   20 120 kg",
    "Pesee 2 (tare)   12 280 kg",
    "Poids net         7 840 kg",
]


def render(lines: list[str], rotate: int = 0) -> bytes:
    img = Image.new("RGB", (900, 60 + 48 * len(lines)), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSansMono.ttf", 30)
    except OSError:
        font = ImageFont.load_default(size=30)
    for i, line in enumerate(lines):
        d.text((30, 30 + 48 * i), line, fill="black", font=font)
    if rotate:
        img = img.rotate(rotate, expand=True, fillcolor="white")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def main() -> int:
    out = read_ticket(render(TICKET))
    text = out["text"]
    print(text)
    print("mean confidence:", out["meanConfidence"])
    failures = [s for s in ("7 840", "20 120", "12 280", "2026-04812") if s not in text]
    net_line = next((l for l in out["lines"] if "net" in l["text"].lower()), None)
    if net_line is None or net_line["conf"] < 0.6:
        failures.append(f"net line confidence {net_line}")
    blank = read_ticket(render([" "]))
    if blank["lines"]:
        failures.append("blank photo produced text")
    assert base64.b64encode(render(TICKET))  # payload is what the app sends
    if failures:
        print("FAIL", failures)
        return 1
    print("OK engine reads the ticket")
    return 0


if __name__ == "__main__":
    sys.exit(main())
