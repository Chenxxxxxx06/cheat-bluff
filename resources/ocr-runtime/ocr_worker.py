"""Local PaddleOCR bridge used by Cheater.

PaddleOCR is Apache-2.0 licensed: https://github.com/PaddlePaddle/PaddleOCR
This bridge deliberately exposes a tiny JSON contract so the Electron main
process never imports Python or native inference modules in-process.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import sys

MAX_PAGES = 1000
MAX_CHARACTERS = 25_000_000
MAX_RENDER_PIXELS = 20_000_000
MAX_RENDER_DIMENSION = 12_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("--language", default="ch")
    parser.add_argument("--max-pages", type=int, default=MAX_PAGES)
    parser.add_argument("--pages", default="", help="Comma-separated one-based PDF pages to OCR")
    return parser.parse_args()


def selected_pdf_pages(value: str, total_pages: int, max_pages: int) -> list[int]:
    if not value.strip():
        if total_pages > max_pages:
            raise RuntimeError(f"PDF exceeds OCR page limit ({total_pages} pages).")
        return list(range(total_pages))
    selected: list[int] = []
    for token in value.split(","):
        try:
            page_number = int(token.strip())
        except ValueError as error:
            raise RuntimeError("Invalid OCR page selection.") from error
        if page_number < 1 or page_number > total_pages:
            raise RuntimeError(f"OCR page is outside the PDF ({page_number}).")
        page_index = page_number - 1
        if page_index not in selected:
            selected.append(page_index)
    if not selected or len(selected) > max_pages:
        raise RuntimeError("OCR page selection exceeds the page limit.")
    return selected


def safe_render_scale(page: object) -> float:
    width, height = page.get_size()
    width = float(width)
    height = float(height)
    if not math.isfinite(width) or not math.isfinite(height) or width <= 0 or height <= 0:
        raise RuntimeError("PDF page has invalid dimensions.")
    scale = min(
        2.0,
        MAX_RENDER_DIMENSION / width,
        MAX_RENDER_DIMENSION / height,
        math.sqrt(MAX_RENDER_PIXELS / (width * height)),
    )
    if not math.isfinite(scale) or scale <= 0:
        raise RuntimeError("PDF page cannot be rendered safely.")
    rendered_width = math.ceil(width * scale)
    rendered_height = math.ceil(height * scale)
    if (rendered_width <= 0 or rendered_height <= 0
            or rendered_width > MAX_RENDER_DIMENSION or rendered_height > MAX_RENDER_DIMENSION
            or rendered_width * rendered_height > MAX_RENDER_PIXELS):
        raise RuntimeError("PDF page exceeds the OCR render pixel limit.")
    return scale


def result_text(result: object) -> str:
    payload = getattr(result, "json", result)
    if callable(payload):
        payload = payload()
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        return ""
    data = payload.get("res", payload)
    texts = data.get("rec_texts", []) if isinstance(data, dict) else []
    scores = data.get("rec_scores", []) if isinstance(data, dict) else []
    lines: list[str] = []
    for index, value in enumerate(texts if isinstance(texts, list) else []):
        score = scores[index] if isinstance(scores, list) and index < len(scores) else 1
        if isinstance(value, str) and value.strip() and float(score or 0) >= 0.35:
            lines.append(value.strip())
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    source = args.input.resolve(strict=True)
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    os.environ.setdefault("PADDLE_PDX_CPU_NUM_THREADS", str(max(1, min(8, os.cpu_count() or 4))))
    # Paddle 3.3 currently fails on an OCRv5 PIR attribute through oneDNN on
    # some Windows CPUs. The plain Paddle CPU engine is slower but portable.
    os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "False")

    from paddleocr import PaddleOCR
    import pypdfium2 as pdfium

    cache_root = pathlib.Path(os.environ.get("PADDLE_PDX_CACHE_HOME", "")).resolve(strict=True)
    detection_model_dir = cache_root / "official_models" / "PP-OCRv5_mobile_det"
    recognition_model_dir = cache_root / "official_models" / "PP-OCRv5_mobile_rec"
    for required in (detection_model_dir, recognition_model_dir):
        if not (required / "inference.json").is_file() or not (required / "inference.pdiparams").is_file():
            raise RuntimeError(f"Bundled OCR model is incomplete: {required.name}")

    ocr = PaddleOCR(
        # The mobile v5 pair is smaller and more reliable for a bundled,
        # CPU-only desktop runtime while retaining Simplified Chinese support.
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_detection_model_dir=str(detection_model_dir),
        text_recognition_model_name="PP-OCRv5_mobile_rec",
        text_recognition_model_dir=str(recognition_model_dir),
        device="cpu",
        engine="paddle_static",
        engine_config={"run_mode": "paddle", "enable_new_ir": False, "enable_cinn": False},
        enable_hpi=False,
        enable_mkldnn=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    pages: list[str] = []
    if source.suffix.lower() == ".pdf":
        document = pdfium.PdfDocument(str(source))
        try:
            page_indexes = selected_pdf_pages(
                args.pages,
                len(document),
                min(MAX_PAGES, max(1, args.max_pages)),
            )
            for page_index in page_indexes:
                page = document[page_index]
                bitmap = page.render(scale=safe_render_scale(page))
                try:
                    image = bitmap.to_numpy()
                    lines = [result_text(item) for item in ocr.predict(image)]
                    text = "\n".join(value for value in lines if value).strip()
                    pages.append(f"[第 {page_index + 1} 页]\n{text}")
                finally:
                    bitmap.close()
                    page.close()
        finally:
            document.close()
    else:
        lines = [result_text(item) for item in ocr.predict(str(source))]
        pages.append("\n".join(value for value in lines if value).strip())
    text = "\n\n".join(pages).strip()
    if len(text) > MAX_CHARACTERS:
        raise RuntimeError("OCR output exceeds character limit.")
    sys.stdout.write(json.dumps({"ok": True, "text": text, "pages": len(pages)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    exit_code = 0
    try:
        exit_code = main()
    except Exception as error:
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)[:1000]}, ensure_ascii=False))
        exit_code = 1
    # Paddle may leave non-daemon native worker threads alive in a standalone
    # runtime. All files and PDF objects are closed above, so flush the tiny
    # JSON protocol response and terminate without waiting for those threads.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(exit_code)
