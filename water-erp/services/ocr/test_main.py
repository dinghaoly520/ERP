import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

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


if __name__ == "__main__":
    unittest.main()
