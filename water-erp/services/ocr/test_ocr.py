#!/usr/bin/env python3
"""Test OCR on a scanned PDF file."""

import os
import sys
import time
import json
from pathlib import Path

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ocr_engine import (
    get_pdf_parser,
    start_hybrid_pool,
    stop_hybrid_server,
    get_hybrid_pool,
    HYBRID_PORT,
    HYBRID_WORKERS,
)


def test_ocr_pdf(pdf_path: str, output_dir: str = None):
    """Test OCR on a PDF file and save results."""
    pdf_path = Path(pdf_path).expanduser().resolve()
    if not pdf_path.exists():
        print(f"Error: File not found: {pdf_path}")
        return

    if output_dir is None:
        output_dir = pdf_path.parent
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"PDF file: {pdf_path}")
    print(f"File size: {pdf_path.stat().st_size / 1024 / 1024:.2f} MB")
    print(f"Output dir: {output_dir}")
    print()

    # Read PDF content
    with open(pdf_path, "rb") as f:
        content = f.read()

    print(f"Loaded {len(content) / 1024 / 1024:.2f} MB into memory")
    print()

    # Start hybrid pool for parallel OCR
    print("Starting hybrid OCR pool...")
    start_hybrid_pool()
    pool = get_hybrid_pool()
    print(f"Hybrid pool running: {pool.running if pool else False}")
    print(f"Workers: {len(pool.get_ports()) if pool else 0}")
    print()

    # Get parser
    parser = get_pdf_parser()
    if parser is None:
        print("Error: PDF parser not available")
        return

    # First, try local parse to check if scanned
    print("Step 1: Local parsing (checking if scanned)...")
    t0 = time.time()
    try:
        _, local_pages = parser.parse_pdf_local(content)
        local_time = time.time() - t0
        print(f"Local parse time: {local_time:.2f}s")
        print(f"Pages found: {len(local_pages)}")

        # Check if scanned
        img_only = sum(
            1 for p in local_pages
            if p["text"].strip().startswith("![image") and len(p["text"].strip()) < 200
        )
        is_scanned = img_only > len(local_pages) * 0.5
        print(f"Image-only pages: {img_only}/{len(local_pages)}")
        print(f"Is scanned: {is_scanned}")
    except Exception as e:
        print(f"Local parse error: {e}")
        local_pages = []
        is_scanned = True
    print()

    # If scanned, use parallel hybrid OCR
    if is_scanned and pool is not None:
        print("Step 2: Parallel hybrid OCR (this may take a while)...")
        t0 = time.time()
        try:
            full_text, pages = parser.parse_pdf_hybrid_parallel(content)
            ocr_time = time.time() - t0
            print(f"Hybrid OCR time: {ocr_time:.2f}s")
            print(f"Pages processed: {len(pages)}")
        except Exception as e:
            print(f"Hybrid OCR error: {e}")
            import traceback
            traceback.print_exc()
            full_text, pages = "", []
    else:
        print("Not scanned or no hybrid pool, using local result")
        full_text = "\n\n".join(p["text"] for p in local_pages)
        pages = local_pages
    print()

    # Save results
    if pages:
        # Save full text
        txt_path = output_dir / f"{pdf_path.stem}_ocr.txt"
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(full_text)
        print(f"Saved text to: {txt_path}")
        print(f"Text size: {len(full_text)} chars")

        # Save JSON with page details
        json_path = output_dir / f"{pdf_path.stem}_ocr.json"
        result = {
            "source_file": str(pdf_path),
            "file_size_mb": pdf_path.stat().st_size / 1024 / 1024,
            "page_count": len(pages),
            "is_scanned": is_scanned,
            "pages": pages,
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"Saved JSON to: {json_path}")

        # Print sample
        print()
        print("=" * 60)
        print("SAMPLE OUTPUT (first 3 pages):")
        print("=" * 60)
        for p in pages[:3]:
            print(f"\n--- Page {p['page']} ---")
            print(p["text"][:500] + "..." if len(p["text"]) > 500 else p["text"])
    else:
        print("No pages extracted!")

    # Cleanup
    print()
    print("Stopping hybrid servers...")
    stop_hybrid_server()
    print("Done.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_ocr.py <pdf_path> [output_dir]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None
    test_ocr_pdf(pdf_path, output_dir)
