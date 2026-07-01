import io
import logging
import numpy as np
import fitz  # PyMuPDF

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

from ocr_engine import (
    ENGINE_NAME,
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

app = FastAPI(title="OCR Service", version="1.1.0")


@app.get("/health")
async def health():
    hybrid_running = False
    workers = 0
    pool = get_hybrid_pool()
    if pool is not None:
        hybrid_running = pool.running
        workers = pool.active_workers
    return {"status": "ok", "engine": ENGINE_NAME, "hybrid": hybrid_running, "workers": workers}


@app.post("/ocr")
async def ocr_file(
    file: UploadFile = File(...),
    dpi: int = Form(150),
    max_pages: int = Form(200),
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
        return await _ocr_pdf(content, dpi, max_pages, page_range)
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


async def _ocr_pdf(content: bytes, dpi: int, max_pages: int, page_range: str = None) -> JSONResponse:
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
        images = []
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            pix = page.get_pixmap(dpi=dpi)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            images.append(img)
        doc.close()
    except Exception as e:
        logger.error(f"PDF to image conversion failed: {e}")
        raise HTTPException(status_code=422, detail=f"PDF conversion failed: {e}")

    if max_pages and len(images) > max_pages:
        images = images[:max_pages]
        logger.warning(f"Truncated PDF batch from {len(images)} to {max_pages} pages")

    texts = ocr_images(images)

    pages = [{"page": i + 1, "text": t} for i, t in enumerate(texts)]

    return JSONResponse(
        {
            "text": "\n\n".join(texts),
            "page_count": original_page_count,
            "processed_pages": len(images),
            "pages": pages,
        }
    )


async def _ocr_image(content: bytes) -> JSONResponse:
    try:
        img = Image.open(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Image open failed: {e}")

    text = ocr_image(img)
    return JSONResponse(
        {
            "text": text,
            "page_count": 1,
            "processed_pages": 1,
            "pages": [{"page": 1, "text": text}],
        }
    )
