import asyncio
import io
import logging
import os
import time
import numpy as np
import fitz  # PyMuPDF

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

from ocr_engine import (
    ENGINE_NAME,
    NUM_WORKERS,
    OCR_INTRA_THREADS,
    OCR_INTER_THREADS,
    _resolve_int_env,
    get_engine,
    get_pdf_parser,
    get_hybrid_pool,
    ocr_image,
    ocr_images,
    start_hybrid_pool,
    stop_hybrid_server,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="OCR Service", version="1.3.0")

# OCR 是 CPU 密集同步操作：必须在 executor 里跑并加锁串行化——
# ① 事件循环不再被阻塞（/health 永远可用，可区分"在处理"与"挂死"）；
# ② 同一时刻至多一个 OCR 批次，避免跨请求 OMP/GIL 过度争用与内存叠加。
_ocr_lock = asyncio.Lock()
_busy = {"active": False, "since": 0.0, "detail": ""}
# 分页渲染块大小：渲染→OCR→释放，避免整本 PDF 的像素图常驻内存（191 页原需数 GB）
OCR_CHUNK_PAGES = int(os.environ.get("OCR_CHUNK_PAGES", "16"))
# 服务端表单默认（客户端显式传参可覆盖）：低配机可经 env 降档
DEFAULT_DPI = _resolve_int_env(os.environ, "OCR_DEFAULT_DPI", 150)
DEFAULT_MAX_PAGES = _resolve_int_env(os.environ, "OCR_MAX_PAGES_DEFAULT", 200)
# 文字层快速路径阈值：页内嵌文字层字符数达此值则直接取文本免 OCR（0=禁用恒走 OCR）
TEXT_LAYER_MIN_CHARS = _resolve_int_env(os.environ, "OCR_TEXT_LAYER_MIN_CHARS", 100)


def _should_use_text_layer(text: str, min_chars: int) -> bool:
    """数字原生 PDF 快速路径判定：min_chars>0 且去空白后字符数达阈值。

    短文本页（水印/页眉/扫描占位）不达阈值，整页回退 OCR，不产出半截结果。
    """
    return min_chars > 0 and len(text.strip()) >= min_chars


async def _run_ocr_batch(images: list, detail: str) -> list:
    loop = asyncio.get_running_loop()
    async with _ocr_lock:
        _busy.update(active=True, since=time.monotonic(), detail=detail)
        try:
            return await loop.run_in_executor(None, ocr_images, images)
        finally:
            _busy["active"] = False


async def _run_ocr_single(img) -> str:
    loop = asyncio.get_running_loop()
    async with _ocr_lock:
        _busy.update(active=True, since=time.monotonic(), detail="single image")
        try:
            return await loop.run_in_executor(None, ocr_image, img)
        finally:
            _busy["active"] = False


@app.get("/health")
async def health():
    hybrid_running = False
    workers = 0
    pool = get_hybrid_pool()
    if pool is not None:
        hybrid_running = pool.running
        workers = pool.active_workers
    payload = {
        "status": "ok",
        "engine": ENGINE_NAME,
        "hybrid": hybrid_running,
        "workers": workers,
        "busy": _busy["active"],
        # 生效配置上报（不依赖引擎 warmup；0=未限制/包默认）
        "num_workers": NUM_WORKERS,
        "intra_threads": OCR_INTRA_THREADS,
        "inter_threads": OCR_INTER_THREADS,
        "chunk_pages": OCR_CHUNK_PAGES,
    }
    if _busy["active"]:
        payload["busy_seconds"] = round(time.monotonic() - _busy["since"], 1)
        payload["busy_detail"] = _busy["detail"]
    return payload


@app.post("/ocr")
async def ocr_file(
    file: UploadFile = File(...),
    dpi: int = Form(DEFAULT_DPI),
    max_pages: int = Form(DEFAULT_MAX_PAGES),
    page_range: str = Form(None),
):
    filename = file.filename or "unknown"
    content = await file.read()

    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    is_pdf = (
        filename.lower().endswith(".pdf")
        or file.content_type == "application/pdf"
    )

    if is_pdf:
        if ENGINE_NAME == "opendataloader":
            return await _parse_pdf_opendataloader(content, max_pages, page_range)
        return await _ocr_pdf(content, dpi, max_pages, page_range, filename)
    else:
        return await _ocr_image(content)


@app.on_event("startup")
async def _warmup():
    if ENGINE_NAME == "opendataloader":
        try:
            start_hybrid_pool()
        except Exception as e:
            logger.error(f"Failed to start hybrid pool: {e}")
        get_pdf_parser()
    else:
        get_engine()
    logger.info(f"OCR engine warmup complete (engine={ENGINE_NAME})")


@app.on_event("shutdown")
async def _shutdown():
    stop_hybrid_server()


def _extract_page_range(content: bytes, page_range: str) -> bytes:
    if not page_range:
        return content

    try:
        start_text, end_text = page_range.split('-', 1)
        start_page = int(start_text)
        end_page = int(end_text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid page_range: {page_range}") from e

    try:
        doc = fitz.open(stream=content, filetype="pdf")
        total_pages = len(doc)
        if start_page < 1 or end_page < start_page or start_page > total_pages:
            doc.close()
            raise HTTPException(status_code=400, detail=f"Invalid page_range for {total_pages} pages: {page_range}")

        end_page = min(total_pages, end_page)
        new_doc = fitz.open()
        new_doc.insert_pdf(doc, from_page=start_page - 1, to_page=end_page - 1)
        doc.close()

        result = new_doc.tobytes()
        new_doc.close()

        logger.info(f"Extracted pages {start_page}-{end_page} from {total_pages} total pages")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to extract page range: {e}")
        raise HTTPException(status_code=422, detail=f"PDF page range extraction failed: {e}") from e


def _pdf_page_count(content: bytes) -> int:
    try:
        doc = fitz.open(stream=content, filetype="pdf")
        page_count = len(doc)
        doc.close()
        return page_count
    except Exception as e:
        logger.error(f"Failed to count PDF pages: {e}")
        raise HTTPException(status_code=422, detail=f"PDF page count failed: {e}") from e


def _prepare_pdf(content: bytes, max_pages: int, page_range: str = None):
    """Common PDF preparation: get page count, handle max_pages=0, extract page_range.

    Returns (page_count, content_or_none). content_or_none is None when max_pages==0
    signals an early-return page-count-only response.
    """
    original_page_count = _pdf_page_count(content)

    if max_pages == 0 and not page_range:
        return original_page_count, None

    if page_range:
        content = _extract_page_range(content, page_range)

    return original_page_count, content


async def _parse_pdf_opendataloader(
    content: bytes, max_pages: int, page_range: str = None
) -> JSONResponse:
    parser = get_pdf_parser()
    if parser is None:
        logger.warning("OpenDataLoader parser unavailable, falling back to OCR")
        return await _ocr_pdf(content, 150, max_pages, page_range)

    original_page_count, content = _prepare_pdf(content, max_pages, page_range)
    if content is None:
        return JSONResponse(
            {
                "text": "",
                "page_count": original_page_count,
                "processed_pages": 0,
                "pages": [],
            }
        )

    # Try local parse first
    try:
        full_text, pages = parser.parse_pdf_local(content)
    except Exception as e:
        logger.error(f"OpenDataLoader local parsing failed: {e}")
        full_text, pages = "", []

    # If scanned (mostly images), retry with parallel hybrid OCR
    if _is_scanned(pages) and get_hybrid_pool() is not None:
        logger.info("Detected scanned PDF, switching to parallel hybrid OCR mode")
        try:
            full_text, pages = parser.parse_pdf_hybrid_parallel(content, num_pages=max_pages)
        except Exception as e:
            logger.error(f"OpenDataLoader parallel hybrid OCR failed: {e}")
            raise HTTPException(
                status_code=422, detail=f"Hybrid OCR failed: {e}"
            )

    if max_pages and len(pages) > max_pages:
        orig = len(pages)
        pages = pages[:max_pages]
        logger.warning(f"Truncated from {orig} to {max_pages} pages")

    return JSONResponse(
        {
            "text": full_text,
            "page_count": original_page_count,
            "processed_pages": len(pages),
            "pages": pages,
        }
    )


def _is_scanned(pages: list) -> bool:
    if not pages:
        return True
    img_only = sum(
        1 for p in pages
        if p["text"].strip().startswith("![image") and len(p["text"].strip()) < 200
    )
    return img_only > len(pages) * 0.5


async def _ocr_pdf(content: bytes, dpi: int, max_pages: int, page_range: str = None, filename: str = "pdf") -> JSONResponse:
    original_page_count, content = _prepare_pdf(content, max_pages, page_range)
    if content is None:
        return JSONResponse(
            {
                "text": "",
                "page_count": original_page_count,
                "processed_pages": 0,
                "pages": [],
            }
        )

    try:
        doc = fitz.open(stream=content, filetype="pdf")
        total = len(doc)
    except Exception as e:
        logger.error(f"PDF to image conversion failed: {e}")
        raise HTTPException(status_code=422, detail=f"PDF conversion failed: {e}")

    process_count = total
    if max_pages and total > max_pages:
        process_count = max_pages
        logger.warning(f"Truncated PDF batch from {total} to {max_pages} pages")

    # 分块：渲染 OCR_CHUNK_PAGES 页 → OCR → 释放像素，峰值内存 ≈ 单块大小。
    # 文字层快速路径：页内嵌文字层达 TEXT_LAYER_MIN_CHARS 直接取文本免 OCR（逐页分流）。
    page_results: list[dict] = []
    try:
        for start in range(0, process_count, OCR_CHUNK_PAGES):
            end = min(start + OCR_CHUNK_PAGES, process_count)
            chunk_pages: list = [None] * (end - start)
            images = []
            ocr_local_idx = []
            for page_idx in range(start, end):
                layer_text = doc[page_idx].get_text("text")
                if _should_use_text_layer(layer_text, TEXT_LAYER_MIN_CHARS):
                    chunk_pages[page_idx - start] = {
                        "page": page_idx + 1,
                        "text": layer_text.strip(),
                        "source": "text-layer",
                    }
                else:
                    page = doc[page_idx]
                    pix = page.get_pixmap(dpi=dpi)
                    images.append(
                        Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    )
                    ocr_local_idx.append(page_idx - start)
            detail = f"{filename} p{start + 1}-{end}/{process_count}"
            if images:
                chunk_texts = await _run_ocr_batch(images, detail)
                for local_i, t in zip(ocr_local_idx, chunk_texts):
                    chunk_pages[local_i] = {
                        "page": start + local_i + 1,
                        "text": t,
                        "source": "ocr",
                    }
            page_results.extend(chunk_pages)
            del images
    finally:
        doc.close()

    pages = page_results

    return JSONResponse(
        {
            "text": "\n\n".join(p["text"] for p in pages),
            "page_count": original_page_count,
            "processed_pages": len(pages),
            "pages": pages,
        }
    )


async def _ocr_image(content: bytes) -> JSONResponse:
    try:
        img = Image.open(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Image open failed: {e}")

    text = await _run_ocr_single(img)
    return JSONResponse(
        {
            "text": text,
            "page_count": 1,
            "processed_pages": 1,
            "pages": [{"page": 1, "text": text}],
        }
    )
