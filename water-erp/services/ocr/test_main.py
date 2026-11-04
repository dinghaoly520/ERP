import asyncio
import io
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))

import fitz

import main
from main import _should_use_text_layer


class ParsePdfOpenDataLoaderTest(unittest.TestCase):
    def test_max_pages_zero_returns_page_count_without_parsing(self):
        parser = Mock()
        parser.parse_pdf_local.side_effect = AssertionError(
            "parse_pdf_local should not run for page-count-only requests"
        )

        with patch.object(main, "_pdf_page_count", return_value=12), patch.object(
            main, "get_pdf_parser", return_value=parser
        ):
            response = asyncio.run(main._parse_pdf_opendataloader(b"%PDF", 0))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.body,
            b'{"text":"","page_count":12,"processed_pages":0,"pages":[]}',
        )
        parser.parse_pdf_local.assert_not_called()


class HealthConfigReportTest(unittest.TestCase):
    def test_health_reports_effective_config_before_warmup(self):
        payload = asyncio.run(main.health())
        for key in ("num_workers", "intra_threads", "inter_threads", "chunk_pages"):
            self.assertIn(key, payload)
            self.assertIsInstance(payload[key], int)
        self.assertEqual(payload["num_workers"], main.NUM_WORKERS)


class FormDefaultsTest(unittest.TestCase):
    def test_env_backed_defaults_are_ints(self):
        self.assertIsInstance(main.DEFAULT_DPI, int)
        self.assertGreater(main.DEFAULT_MAX_PAGES, 0)


class TextLayerFastPathTest(unittest.TestCase):
    def test_should_use_text_layer_boundaries(self):
        self.assertFalse(_should_use_text_layer("", 100))            # 空页
        self.assertFalse(_should_use_text_layer("水印", 100))         # 短文本（水印/页眉）
        self.assertTrue(_should_use_text_layer("字" * 100, 100))      # 达阈值
        self.assertFalse(_should_use_text_layer("字" * 999, 0))       # 0=禁用快速路径

    def test_ocr_pdf_mixed_pages_split(self):
        doc = fitz.open()
        p1 = doc.new_page()  # 长文字层（分 3 行注入——insert_text 单行超页宽会截断）
        for i, y in enumerate((80, 100, 120)):
            p1.insert_text((72, y), f"P1MARKER-L{i}-" + "x" * 50)
        doc.new_page().insert_text((72, 96), "abc")                    # 短文本
        doc.new_page()                                                 # 无文字
        pdf_bytes = doc.tobytes()
        doc.close()

        calls = []

        async def fake_batch(images, detail):
            calls.append((len(images), detail))
            return ["P2-OCR", "P3-OCR"]

        with patch.object(main, "_run_ocr_batch", fake_batch):
            resp = asyncio.run(main._ocr_pdf(pdf_bytes, 150, 10))

        body = json.loads(resp.body)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 2, "仅短文本页与空页进 OCR")
        pages = body["pages"]
        self.assertEqual(pages[0]["source"], "text-layer")
        self.assertIn("P1MARKER", pages[0]["text"])
        self.assertEqual(pages[1]["source"], "ocr")
        self.assertEqual(pages[1]["text"], "P2-OCR")
        self.assertEqual(pages[2]["source"], "ocr")
        self.assertEqual(pages[2]["text"], "P3-OCR")
        self.assertEqual(body["processed_pages"], 3)


class FastPathGuardsTest(unittest.TestCase):
    """评审修复：快速路径三护栏（乱码层 / CHUNK_PAGES 非法值 / 图像覆盖率）"""

    def test_garbled_layer_with_ufffd_rejected(self):
        # 消费者（knowledge document-parser）依赖 OCR 修复乱码文字层——含 U+FFFD 不得走快速路径
        self.assertFalse(_should_use_text_layer("�" * 150, 100))
        self.assertTrue(_should_use_text_layer("正常文字" * 30 + "x" * 20, 100))

    def test_chunk_pages_invalid_env_does_not_crash_import(self):
        r = subprocess.run(
            [sys.executable, "-c", "import main"],
            cwd=str(Path(__file__).parent),
            env={**os.environ, "OCR_CHUNK_PAGES": "abc"},
            capture_output=True,
        )
        self.assertEqual(r.returncode, 0, r.stderr.decode(errors="replace")[-300:])

    def _pdf_with_image(self, img_rect) -> bytes:
        doc = fitz.open()
        page = doc.new_page()
        for i, y in enumerate((90, 120, 150)):  # 密集文字层 ≥100 字符
            page.insert_text((72, y), f"TXT-L{i}-" + "y" * 30)
        pic = Image.new("RGB", (600, 400), "white")
        ImageDraw.Draw(pic).text((60, 100), "CERT-99008877", fill="black")
        pb = io.BytesIO()
        pic.save(pb, "PNG")
        page.insert_image(img_rect, stream=pb.getvalue())
        b = doc.tobytes()
        doc.close()
        return b

    def test_page_with_large_image_goes_to_ocr(self):
        pdf_bytes = self._pdf_with_image(fitz.Rect(50, 300, 450, 700))  # ~25% 页面积
        calls = []

        async def fake_batch(images, detail):
            calls.append(len(images))
            return ["OCR-MIXED"]

        with patch.object(main, "_run_ocr_batch", fake_batch):
            resp = asyncio.run(main._ocr_pdf(pdf_bytes, 150, 10))
        body = json.loads(resp.body)
        self.assertEqual(body["pages"][0]["source"], "ocr")
        self.assertEqual(body["pages"][0]["text"], "OCR-MIXED")
        self.assertEqual(calls, [1])

    def test_page_with_small_logo_keeps_fast_path(self):
        pdf_bytes = self._pdf_with_image(fitz.Rect(40, 40, 80, 80))  # ~0.5% 页面积（logo 级）
        calls = []

        async def fake_batch(images, detail):
            calls.append(len(images))
            return ["SHOULD-NOT-RUN"]

        with patch.object(main, "_run_ocr_batch", fake_batch):
            resp = asyncio.run(main._ocr_pdf(pdf_bytes, 150, 10))
        body = json.loads(resp.body)
        self.assertEqual(body["pages"][0]["source"], "text-layer")
        self.assertIn("TXT-L0", body["pages"][0]["text"])
        self.assertEqual(calls, [])


class MaxPagesDefaultGuardTest(unittest.TestCase):
    """M1：OCR_MAX_PAGES_DEFAULT=0 回落 200（0 会把所有缺省请求变空探测，语义陷阱）"""

    def test_max_pages_default_zero_falls_back_200(self):
        r = subprocess.run(
            [sys.executable, "-c", "import main; print(main.DEFAULT_MAX_PAGES)"],
            cwd=str(Path(__file__).parent),
            env={**os.environ, "OCR_MAX_PAGES_DEFAULT": "0"},
            capture_output=True,
            text=True,
        )
        self.assertEqual(r.returncode, 0, r.stderr[-300:])
        self.assertEqual(r.stdout.strip(), "200")


class BusyDetailScopeTest(unittest.TestCase):
    """M8：busy_detail 只报实际进 OCR 的页，不夸大整块范围"""

    def test_busy_detail_reports_ocr_pages_only(self):
        doc = fitz.open()
        p1 = doc.new_page()  # 文字层页（不进 OCR）
        for i, y in enumerate((80, 100, 120)):
            p1.insert_text((72, y), f"DETAIL-P1-L{i}-" + "z" * 40)
        doc.new_page().insert_text((72, 96), "abc")  # 短文本 → OCR
        doc.new_page()  # 空 → OCR
        pdf_bytes = doc.tobytes()
        doc.close()

        details = []

        async def fake_batch(images, detail):
            details.append(detail)
            return ["P2", "P3"]

        with patch.object(main, "_run_ocr_batch", fake_batch):
            asyncio.run(main._ocr_pdf(pdf_bytes, 150, 10))

        self.assertEqual(len(details), 1)
        self.assertIn("p2-3", details[0])
        self.assertNotIn("p1-3", details[0])


if __name__ == "__main__":
    unittest.main()
