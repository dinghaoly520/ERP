#!/usr/bin/env python3
"""Benchmark OCR with different worker counts."""

import os
import sys
import time
import json
import subprocess
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ocr_engine import (
    get_pdf_parser,
    start_hybrid_pool,
    stop_hybrid_server,
    get_hybrid_pool,
)

PDF_PATH = Path("/home/swhi/Desktop/procurement/资料/标书及投标文件/引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务-四川省第四地质大队.pdf")
TEST_PAGES = 20  # Test with first 20 pages for faster benchmark


def get_gpu_memory():
    """Get current GPU memory usage."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            parts = result.stdout.strip().split(",")
            used = int(parts[0].strip())
            free = int(parts[1].strip()) if parts[1].strip() != "N/A" else -1
            return used, free
    except Exception:
        pass
    return -1, -1


def benchmark_workers(num_workers: int):
    """Benchmark OCR with specified worker count."""
    print(f"\n{'='*60}")
    print(f"Testing with {num_workers} workers")
    print(f"{'='*60}")

    # Read PDF
    with open(PDF_PATH, "rb") as f:
        content = f.read()

    # Get initial GPU memory
    gpu_used_before, gpu_free_before = get_gpu_memory()
    print(f"GPU memory before: used={gpu_used_before}MiB, free={gpu_free_before}MiB")

    # Start pool
    print(f"Starting {num_workers} hybrid servers...")
    t0 = time.time()
    start_hybrid_pool(num_workers=num_workers)
    startup_time = time.time() - t0
    print(f"Startup time: {startup_time:.2f}s")

    pool = get_hybrid_pool()
    if not pool or not pool.running:
        print("ERROR: Pool not running!")
        stop_hybrid_server()
        return None

    # Get GPU memory after startup
    gpu_used_after, gpu_free_after = get_gpu_memory()
    print(f"GPU memory after startup: used={gpu_used_after}MiB, free={gpu_free_after}MiB")
    if gpu_used_after > 0 and gpu_used_before > 0:
        print(f"GPU memory per worker: {(gpu_used_after - gpu_used_before) / num_workers:.0f}MiB")

    # Parse PDF
    parser = get_pdf_parser()

    print(f"Parsing first {TEST_PAGES} pages...")
    t0 = time.time()

    try:
        # Use hybrid parallel with limited pages
        full_text, pages = parser.parse_pdf_hybrid_parallel(content, num_pages=TEST_PAGES)
        parse_time = time.time() - t0

        # Get GPU memory during processing
        gpu_used_during, gpu_free_during = get_gpu_memory()

        result = {
            "workers": num_workers,
            "startup_time": startup_time,
            "parse_time": parse_time,
            "pages_processed": len(pages),
            "total_chars": sum(len(p["text"]) for p in pages),
            "chars_per_page": sum(len(p["text"]) for p in pages) / len(pages) if pages else 0,
            "pages_per_second": len(pages) / parse_time if parse_time > 0 else 0,
            "gpu_used_before": gpu_used_before,
            "gpu_used_after": gpu_used_after,
            "gpu_used_during": gpu_used_during,
            "gpu_per_worker": (gpu_used_after - gpu_used_before) / num_workers if gpu_used_after > 0 and gpu_used_before > 0 else -1,
        }

        print(f"\nResults:")
        print(f"  Parse time: {parse_time:.2f}s")
        print(f"  Pages processed: {len(pages)}")
        print(f"  Pages/second: {result['pages_per_second']:.2f}")
        print(f"  Total chars: {result['total_chars']}")
        print(f"  GPU memory during: {gpu_used_during}MiB")

    except Exception as e:
        print(f"ERROR during parsing: {e}")
        result = None

    # Stop servers
    print("Stopping servers...")
    stop_hybrid_server()

    return result


def main():
    print("OCR Worker Benchmark")
    print(f"PDF: {PDF_PATH}")
    print(f"Test pages: {TEST_PAGES}")
    print(f"CPU cores: {os.cpu_count()}")

    # Test different worker counts
    worker_counts = [1, 2, 3, 4]
    results = []

    for n in worker_counts:
        result = benchmark_workers(n)
        if result:
            results.append(result)
        # Wait a bit between tests
        time.sleep(5)

    # Summary
    print(f"\n{'='*60}")
    print("BENCHMARK SUMMARY")
    print(f"{'='*60}")
    print(f"{'Workers':<8} {'Startup':<10} {'Parse':<10} {'Pages/s':<10} {'GPU/worker':<12}")
    print("-" * 50)
    for r in results:
        print(f"{r['workers']:<8} {r['startup_time']:<10.2f} {r['parse_time']:<10.2f} {r['pages_per_second']:<10.2f} {r['gpu_per_worker']:<12.0f}")

    # Find optimal
    if results:
        best = max(results, key=lambda r: r['pages_per_second'])
        print(f"\nRecommended workers: {best['workers']} (highest throughput: {best['pages_per_second']:.2f} pages/s)")

    # Save results
    output_path = PDF_PATH.parent / "ocr_benchmark.json"
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()