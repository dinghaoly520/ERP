import logging
import os
import subprocess
import sys
import time
import tempfile
import math
import threading
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
from typing import Optional, Protocol, runtime_checkable, List, Dict, Tuple
from pathlib import Path
import json
from dotenv import load_dotenv

# Load .env file from the same directory
load_dotenv(Path(__file__).parent / '.env')

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

_engine = None
_thread_pool: Optional[ThreadPoolExecutor] = None
_pdf_parser = None
_hybrid_servers: List["HybridServer"] = []

NUM_WORKERS = 2
MAX_SIDE = int(os.environ.get("OCR_MAX_SIDE", "3000"))
# 挂死自愈：单页 recognize 超过该秒数（onnxruntime 死角死锁，线程无法取消），
# watchdog 守护线程直接终止进程，交由 PM2 约 5s 自动拉起、上游 BullMQ 重试。
# 把"永久挂死需人工 kill"收敛为"≤N 秒自愈"。设 OCR_WATCHDOG=0 可禁用。
OCR_PAGE_TIMEOUT = float(os.environ.get("OCR_PAGE_TIMEOUT", "180"))
OCR_WATCHDOG = os.environ.get("OCR_WATCHDOG", "1") != "0"
ENGINE_NAME = os.environ.get("OCR_ENGINE", "rapid").lower()  # "rapid" | "easy" | "opendataloader"
HYBRID_PORT = int(os.environ.get("OCR_HYBRID_PORT", "5002"))
HYBRID_LANG = os.environ.get("OCR_HYBRID_LANG", "ch_sim,en")
HYBRID_DEVICE = os.environ.get("OCR_HYBRID_DEVICE", "cuda")
HYBRID_OCR_ENGINE = os.environ.get("OCR_HYBRID_OCR_ENGINE", "rapidocr").lower()  # Default to PP-OCRv4
HYBRID_WORKERS = int(os.environ.get("OCR_HYBRID_WORKERS", "2"))  # Number of parallel workers

V5_MODEL_DIR = os.path.expanduser("~/.rapidocr/models/v5")
V5_MODELS_AVAILABLE = (
    os.path.exists(os.path.join(V5_MODEL_DIR, "det_v5.onnx"))
    and os.path.exists(os.path.join(V5_MODEL_DIR, "rec_v5.onnx"))
    and os.path.exists(os.path.join(V5_MODEL_DIR, "ppocrv5_dict.txt"))
)


@runtime_checkable
class OcrEngine(Protocol):
    def recognize(self, arr: np.ndarray) -> str: ...


# ── RapidOCR (PP-OCRv5 server models via ONNX, auto GPU) ──

def _cuda_runtime_present() -> bool:
    """onnxruntime-gpu 即使机器没有 CUDA 也会把 CUDAExecutionProvider 列进
    get_available_providers()，运行时才在加载 libonnxruntime_providers_cuda.so
    时报错回退（每次调用刷屏 + 慢）。用 cudart 动态库存在性做真实判据。"""
    import ctypes.util
    return ctypes.util.find_library("cudart") is not None


class RapidOcrEngine:
    def __init__(self):
        from rapidocr_onnxruntime import RapidOCR
        import onnxruntime as ort

        gpu_config = str(Path(__file__).parent / "config_gpu.yaml")
        use_gpu = (
            "CUDAExecutionProvider" in ort.get_available_providers()
            and Path(gpu_config).exists()
            and _cuda_runtime_present()
        )
        logger.info(
            "GPU detected, using CUDA-accelerated OCR"
            if use_gpu else "No GPU, using CPU OCR"
        )

        if V5_MODELS_AVAILABLE:
            logger.info("Using PP-OCRv5 server models")
            kwargs = dict(
                det_model_path=os.path.join(V5_MODEL_DIR, "det_v5.onnx"),
                rec_model_path=os.path.join(V5_MODEL_DIR, "rec_v5.onnx"),
                rec_keys_path=os.path.join(V5_MODEL_DIR, "ppocrv5_dict.txt"),
            )
            if use_gpu:
                kwargs["config_path"] = gpu_config
            self._engine = RapidOCR(**kwargs)
        else:
            logger.info("Using PP-OCRv4 default models")
            self._engine = RapidOCR(config_path=gpu_config) if use_gpu else RapidOCR()

    def recognize(self, arr: np.ndarray) -> str:
        result, _ = self._engine(arr)
        if not result:
            return ""
        return "\n".join([r[1] for r in result])


# ── EasyOCR ──

class EasyOcrEngine:
    def __init__(self):
        import torch
        from easyocr import Reader

        use_gpu = torch.cuda.is_available()
        logger.info(f"Initializing EasyOCR (gpu={use_gpu})...")
        self._engine = Reader(["ch_sim", "en"], gpu=use_gpu, verbose=False)

    def recognize(self, arr: np.ndarray) -> str:
        results = self._engine.readtext(arr, detail=0, paragraph=True)
        return "\n".join(results)


# ── Hybrid Server Pool ──

class HybridServer:
    """Single hybrid server instance."""

    def __init__(self, port: int, lang: str, device: str = "cuda", ocr_engine: str = "rapidocr"):
        self._port = port
        self._lang = lang
        self._device = device
        self._ocr_engine = ocr_engine
        self._proc: Optional[subprocess.Popen] = None

    @staticmethod
    def _resolve_hybrid_bin(name: str) -> str:
        """Resolve hybrid binary to its absolute path, falling back to bare name.

        When PM2 or a systemd unit starts uvicorn directly without the venv bin
        on PATH, subprocess.Popen cannot find the hybrid binary. Resolve it
        relative to the current Python interpreter (which lives in the same
        venv bin directory)."""
        bin_dir = os.path.dirname(sys.executable)
        candidate = os.path.join(bin_dir, name)
        if os.path.isfile(candidate):
            return candidate
        return name  # fall back to bare name (rely on PATH)

    def start(self):
        if self._proc is not None:
            return

        use_v5 = V5_MODELS_AVAILABLE and self._ocr_engine == "rapidocr"
        hybrid_cmd = self._resolve_hybrid_bin(
            "opendataloader-pdf-hybrid-v5" if use_v5 else "opendataloader-pdf-hybrid"
        )

        cmd = [
            hybrid_cmd,
            "--port", str(self._port),
            "--force-ocr",
            "--ocr-lang", self._lang,
        ]

        # PP-OCRv4 via RapidOCR backend (docling supports RapidOcrOptions natively)
        if self._ocr_engine == "rapidocr" and not use_v5:
            cmd.extend(["--ocr-backend", "rapidocr"])

        if use_v5:
            logger.info(f"[port {self._port}] Using PP-OCRv5 server models")

        logger.info(f"Starting hybrid server: {' '.join(cmd)}")

        # Build subprocess environment: inherit from parent but fix httpx-incompatible
        # ALL_PROXY that may come from shell rc files (e.g. socks:// → socks5://)
        subprocess_env = os.environ.copy()
        for key in ("ALL_PROXY", "all_proxy"):
            val = subprocess_env.get(key, "")
            if val.startswith("socks://"):
                subprocess_env[key] = val.replace("socks://", "socks5://", 1)

        self._proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=subprocess_env,
        )
        self._wait_ready(timeout=120)

    def _wait_ready(self, timeout: int = 120):
        import urllib.request
        import urllib.error

        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                req = urllib.request.urlopen(f"http://127.0.0.1:{self._port}/health", timeout=2)
                if req.status == 200:
                    logger.info(f"Hybrid server ready on port {self._port}")
                    return
            except (urllib.error.URLError, OSError):
                pass
            ret = self._proc.poll()
            if ret is not None:
                stderr = self._proc.stderr.read().decode(errors="replace")[-500:]
                raise RuntimeError(f"Hybrid server exited with code {ret}: {stderr}")
            time.sleep(2)
        raise TimeoutError(f"Hybrid server not ready after {timeout}s")

    def stop(self):
        if self._proc is None:
            return
        logger.info(f"Stopping hybrid server on port {self._port}...")
        self._proc.terminate()
        try:
            self._proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._proc.kill()
        self._proc = None
        logger.info(f"Hybrid server stopped on port {self._port}")

    @property
    def port(self) -> int:
        return self._port

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None


class HybridServerPool:
    """Pool of hybrid servers for parallel processing."""

    def __init__(self, base_port: int, num_workers: int, lang: str, device: str, ocr_engine: str):
        self._base_port = base_port
        self._num_workers = num_workers
        self._servers: List[HybridServer] = []
        self._lang = lang
        self._device = device
        self._ocr_engine = ocr_engine

    def start(self):
        if self._servers:
            return

        logger.info(f"Starting {self._num_workers} hybrid servers (ports {self._base_port}-{self._base_port + self._num_workers - 1})...")

        for i in range(self._num_workers):
            port = self._base_port + i
            server = HybridServer(port, self._lang, self._device, self._ocr_engine)
            server.start()
            self._servers.append(server)

        logger.info(f"All {self._num_workers} hybrid servers ready")

    def stop(self):
        for server in self._servers:
            server.stop()
        self._servers = []

    def get_ports(self) -> List[int]:
        return [s.port for s in self._servers]

    @property
    def running(self) -> bool:
        return len(self._servers) > 0 and all(s.running for s in self._servers)

    @property
    def active_workers(self) -> int:
        return sum(1 for s in self._servers if s.running)


# ── OpenDataLoader PDF Parser (local + hybrid parallel) ──

class OpendataloaderPdfParser:
    def __init__(self, server_ports: Optional[List[int]] = None):
        import opendataloader_pdf
        self._mod = opendataloader_pdf
        self._server_ports = server_ports or [HYBRID_PORT]
        logger.info(f"OpenDataLoader PDF parser initialized with {len(self._server_ports)} workers")

    def parse_pdf_local(self, content: bytes) -> Tuple[str, List[Dict]]:
        return self._convert(content, hybrid=None)

    def parse_pdf_hybrid(self, content: bytes) -> Tuple[str, List[Dict]]:
        return self._convert(content, hybrid="docling-fast", hybrid_mode="full")

    def parse_pdf_hybrid_parallel(self, content: bytes, num_pages: int = None) -> Tuple[str, List[Dict]]:
        """Parse PDF using multiple hybrid servers in parallel."""
        if len(self._server_ports) <= 1:
            return self.parse_pdf_hybrid(content)

        # First, get page count via local parse
        _, local_pages = self._convert(content, hybrid=None)
        if not local_pages:
            return "", []

        total_pages = len(local_pages)
        if num_pages:
            total_pages = min(total_pages, num_pages)

        # Check if scanned
        if not _is_scanned(local_pages):
            # Not scanned, return local result
            full_text = "\n\n".join(p["text"] for p in local_pages[:total_pages])
            return full_text, local_pages[:total_pages]

        # Scanned PDF - use parallel hybrid OCR
        return self._parallel_ocr(content, total_pages)

    def _parallel_ocr(self, content: bytes, total_pages: int) -> Tuple[str, List[Dict]]:
        """Distribute pages across multiple hybrid servers."""
        import fitz  # PyMuPDF

        num_workers = len(self._server_ports)
        pages_per_worker = math.ceil(total_pages / num_workers)

        logger.info(f"Parallel OCR: {total_pages} pages across {num_workers} workers ({pages_per_worker} pages/worker)")

        # Open PDF and split page ranges
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            doc = fitz.open(tmp_path)

            # Submit jobs to each worker
            futures = []
            all_results: List[Dict] = [None] * total_pages

            with ThreadPoolExecutor(max_workers=num_workers) as executor:
                for i, port in enumerate(self._server_ports):
                    start_page = i * pages_per_worker + 1  # 1-indexed
                    end_page = min((i + 1) * pages_per_worker, total_pages)

                    if start_page > total_pages:
                        break

                    future = executor.submit(
                        self._process_page_range,
                        content,
                        start_page,
                        end_page,
                        port,
                    )
                    futures.append((future, start_page, end_page))

            # Collect results
            for future, start_page, end_page in futures:
                try:
                    pages = future.result(timeout=600)
                    for p in pages:
                        if 1 <= p["page"] <= total_pages:
                            all_results[p["page"] - 1] = p
                except Exception as e:
                    logger.error(f"Worker failed for pages {start_page}-{end_page}: {e}")

            doc.close()
        finally:
            os.unlink(tmp_path)

        # Filter out None results and build output
        valid_pages = [p for p in all_results if p is not None]
        full_text = "\n\n".join(p["text"] for p in valid_pages)

        return full_text, valid_pages

    def _process_page_range(self, content: bytes, start_page: int, end_page: int, port: int) -> List[Dict]:
        """Process a range of pages on a specific hybrid server."""
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = os.path.join(tmpdir, "input.pdf")
            out_dir = os.path.join(tmpdir, "out")
            os.makedirs(out_dir)

            with open(pdf_path, "wb") as f:
                f.write(content)

            page_range = f"{start_page}-{end_page}"

            self._mod.convert(
                input_path=[pdf_path],
                output_dir=out_dir,
                format="markdown",
                markdown_page_separator="\n\n---PAGE_BREAK---\n\n",
                hybrid="docling-fast",
                hybrid_mode="full",
                hybrid_url=f"http://127.0.0.1:{port}",
                pages=page_range,
            )

            md_path = os.path.join(out_dir, "input.md")
            if not os.path.exists(md_path):
                for fn in os.listdir(out_dir):
                    if fn.endswith(".md"):
                        md_path = os.path.join(out_dir, fn)
                        break
                else:
                    return []

            with open(md_path, "r", encoding="utf-8") as f:
                raw = f.read()

            parts = raw.split("---PAGE_BREAK---")
            non_empty = [p.strip() for p in parts if p.strip()]
            pages = [{"page": start_page + i, "text": t} for i, t in enumerate(non_empty)]

            return pages

    def _convert(self, content: bytes, hybrid=None, hybrid_mode=None) -> Tuple[str, List[Dict]]:
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = os.path.join(tmpdir, "input.pdf")
            out_dir = os.path.join(tmpdir, "out")
            os.makedirs(out_dir)

            with open(pdf_path, "wb") as f:
                f.write(content)

            kwargs = {}
            if hybrid:
                kwargs["hybrid"] = hybrid
                kwargs["hybrid_url"] = f"http://127.0.0.1:{self._server_ports[0]}"
            if hybrid_mode:
                kwargs["hybrid_mode"] = hybrid_mode

            self._mod.convert(
                input_path=[pdf_path],
                output_dir=out_dir,
                format="markdown",
                markdown_page_separator="\n\n---PAGE_BREAK---\n\n",
                **kwargs,
            )

            md_path = os.path.join(out_dir, "input.md")
            if not os.path.exists(md_path):
                for fn in os.listdir(out_dir):
                    if fn.endswith(".md"):
                        md_path = os.path.join(out_dir, fn)
                        break
                else:
                    return "", []

            with open(md_path, "r", encoding="utf-8") as f:
                raw = f.read()

            parts = raw.split("---PAGE_BREAK---")
            non_empty = [p.strip() for p in parts if p.strip()]
            pages = [{"page": i + 1, "text": t} for i, t in enumerate(non_empty)]
            full_text = raw.replace("---PAGE_BREAK---", "\n\n")
            return full_text, pages


def _is_scanned(pages: list) -> bool:
    """Heuristic: if most pages are only image references, it's scanned."""
    if not pages:
        return False
    img_only = sum(
        1 for p in pages
        if p["text"].strip().startswith("![image") and len(p["text"].strip()) < 200
    )
    return img_only > len(pages) * 0.5


# ── Global instances ──

_hybrid_pool: Optional[HybridServerPool] = None


def _create_pdf_parser():
    try:
        ports = _hybrid_pool.get_ports() if _hybrid_pool else [HYBRID_PORT]
        return OpendataloaderPdfParser(server_ports=ports)
    except ImportError:
        logger.warning("opendataloader-pdf not installed, PDF parsing unavailable")
        return None


def get_pdf_parser():
    global _pdf_parser
    # Re-create parser if pool has more ports than the cached parser
    if _pdf_parser is not None and _hybrid_pool is not None:
        pool_ports = _hybrid_pool.get_ports()
        if len(pool_ports) > len(_pdf_parser._server_ports):
            logger.info(
                f"Re-creating parser: pool has {len(pool_ports)} ports "
                f"but parser only has {len(_pdf_parser._server_ports)}"
            )
            _pdf_parser = None
    if _pdf_parser is None:
        _pdf_parser = _create_pdf_parser()
    return _pdf_parser


def start_hybrid_server():
    """Start a single hybrid server (backward compatible)."""
    global _hybrid_servers
    if _hybrid_servers:
        return
    server = HybridServer(HYBRID_PORT, HYBRID_LANG, HYBRID_DEVICE, HYBRID_OCR_ENGINE)
    server.start()
    _hybrid_servers = [server]


def start_hybrid_pool(num_workers: int = None):
    """Start a pool of hybrid servers for parallel processing."""
    global _hybrid_pool
    if _hybrid_pool is not None and _hybrid_pool.running:
        return

    num_workers = num_workers or HYBRID_WORKERS
    _hybrid_pool = HybridServerPool(
        base_port=HYBRID_PORT,
        num_workers=num_workers,
        lang=HYBRID_LANG,
        device=HYBRID_DEVICE,
        ocr_engine=HYBRID_OCR_ENGINE,
    )
    _hybrid_pool.start()


def stop_hybrid_server():
    """Stop all hybrid servers."""
    global _hybrid_servers, _hybrid_pool

    for server in _hybrid_servers:
        server.stop()
    _hybrid_servers = []

    if _hybrid_pool is not None:
        _hybrid_pool.stop()
        _hybrid_pool = None


def get_hybrid_pool() -> Optional[HybridServerPool]:
    return _hybrid_pool


# ── Engine factory ──

def _create_engine() -> OcrEngine:
    if ENGINE_NAME == "easy":
        logger.info("Using EasyOCR engine")
        return EasyOcrEngine()
    logger.info("Using RapidOCR engine")
    return RapidOcrEngine()


def get_engine() -> OcrEngine:
    global _engine
    if _engine is None:
        _engine = _create_engine()
    return _engine


# ── Image helpers ──

def _to_array(img) -> np.ndarray:
    if isinstance(img, Image.Image):
        w, h = img.size
        if max(w, h) > MAX_SIDE:
            ratio = MAX_SIDE / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        return np.array(img.convert("RGB"))
    if isinstance(img, np.ndarray):
        if img.ndim == 2:
            img = np.stack([img] * 3, axis=-1)
        h, w = img.shape[:2]
        if max(h, w) > MAX_SIDE:
            ratio = MAX_SIDE / max(h, w)
            pil = Image.fromarray(img).resize(
                (int(w * ratio), int(h * ratio)), Image.LANCZOS
            )
            img = np.array(pil)
        return img
    return img


# ── 挂死自愈 watchdog ──

_wd_lock = threading.Lock()
_wd_state = {"in_flight": False, "started": 0.0, "label": ""}


def _wd_begin(label: str) -> None:
    with _wd_lock:
        _wd_state.update(in_flight=True, started=time.monotonic(), label=label)


def _wd_end() -> None:
    with _wd_lock:
        _wd_state["in_flight"] = False


def _watchdog_loop() -> None:
    while True:
        time.sleep(5)
        with _wd_lock:
            if not _wd_state["in_flight"]:
                continue
            elapsed = time.monotonic() - _wd_state["started"]
        if elapsed > OCR_PAGE_TIMEOUT:
            logger.critical(
                f"OCR watchdog: recognize({_wd_state['label']}) 卡死 {elapsed:.0f}s"
                f"（阈值 {OCR_PAGE_TIMEOUT:.0f}s），自杀交 PM2 重启"
            )
            try:
                sys.stdout.flush()
                sys.stderr.flush()
            except Exception:
                pass
            os._exit(1)


if OCR_WATCHDOG:
    threading.Thread(target=_watchdog_loop, name="ocr-watchdog", daemon=True).start()


# ── Public API ──

def ocr_image(img) -> str:
    engine = get_engine()
    arr = _to_array(img)
    _wd_begin("image")
    try:
        return engine.recognize(arr)
    finally:
        _wd_end()


def _ocr_single(arr: np.ndarray) -> str:
    engine = get_engine()
    _wd_begin("page")
    try:
        return engine.recognize(arr)
    finally:
        _wd_end()


def ocr_images(images: list) -> list[str]:
    global _thread_pool
    get_engine()

    arrays = [_to_array(img) for img in images]
    total = len(arrays)

    if _thread_pool is None:
        _thread_pool = ThreadPoolExecutor(max_workers=NUM_WORKERS)

    outputs: list[str] = [None] * total

    def process(idx):
        outputs[idx] = _ocr_single(arrays[idx])
        if (idx + 1) % 10 == 0:
            logger.info(f"OCR progress: {idx + 1}/{total} pages")

    list(_thread_pool.map(process, range(total)))

    if total > 0 and total % 10 != 0:
        logger.info(f"OCR progress: {total}/{total} pages")

    return outputs
