"""Task 1 单测：OCR 引擎细粒度配置解析（线程/worker）。

线程铁律：OCR_NUM_WORKERS × OCR_INTRA_THREADS ≤ 分配给 OCR 的核预算。
"""
import os
import unittest
from unittest.mock import patch

import ocr_engine
from ocr_engine import resolve_thread_config, resolve_num_workers


class ResolveThreadConfigTest(unittest.TestCase):
    def test_empty_env_returns_empty(self):
        self.assertEqual(resolve_thread_config({}), {})

    def test_values_mapped(self):
        self.assertEqual(
            resolve_thread_config({"OCR_INTRA_THREADS": "3", "OCR_INTER_THREADS": "1"}),
            {"intra_op_num_threads": 3, "inter_op_num_threads": 1},
        )

    def test_zero_means_unset(self):
        self.assertEqual(resolve_thread_config({"OCR_INTRA_THREADS": "0"}), {})

    def test_invalid_falls_back_to_default(self):
        self.assertEqual(resolve_thread_config({"OCR_INTRA_THREADS": "abc"}), {})
        self.assertEqual(resolve_thread_config({"OCR_INTRA_THREADS": "-2"}), {})
        self.assertEqual(resolve_thread_config({"OCR_INTER_THREADS": ""}), {})


class ResolveNumWorkersTest(unittest.TestCase):
    def test_default_2(self):
        self.assertEqual(resolve_num_workers({}), 2)

    def test_override(self):
        self.assertEqual(resolve_num_workers({"OCR_NUM_WORKERS": "4"}), 4)

    def test_invalid_falls_back(self):
        self.assertEqual(resolve_num_workers({"OCR_NUM_WORKERS": "x"}), 2)
        self.assertEqual(resolve_num_workers({"OCR_NUM_WORKERS": "0"}), 2)
        self.assertEqual(resolve_num_workers({"OCR_NUM_WORKERS": "-1"}), 2)


class ResolveIntEnvEmptyStringTest(unittest.TestCase):
    """M6：显式设空串与未设置区分——空串要 warn，未设置静默"""

    def test_empty_string_warns_and_falls_back(self):
        with self.assertLogs("ocr_engine", level="WARNING") as cm:
            self.assertEqual(resolve_thread_config({"OCR_INTRA_THREADS": ""}), {})
        self.assertTrue(any("OCR_INTRA_THREADS" in m for m in cm.output))

    def test_absent_key_is_silent(self):
        with self.assertNoLogs("ocr_engine", level="WARNING"):
            self.assertEqual(resolve_thread_config({}), {})


class V5ModelKwargsTest(unittest.TestCase):
    """M7：v5 GPU 分支不注入线程 kwargs（GPU 走 config_gpu.yaml）"""

    def test_v5_cpu_injects_threads(self):
        with patch.dict(os.environ, {"OCR_INTRA_THREADS": "3", "OCR_INTER_THREADS": "1"}):
            kw = ocr_engine._v5_model_kwargs(use_gpu=False)
        self.assertEqual(kw["intra_op_num_threads"], 3)
        self.assertEqual(kw["inter_op_num_threads"], 1)
        self.assertNotIn("config_path", kw)
        self.assertTrue(kw["det_model_path"].endswith("det_v5.onnx"))

    def test_v5_gpu_config_only_no_thread_kwargs(self):
        kw = ocr_engine._v5_model_kwargs(use_gpu=True)
        self.assertIn("config_path", kw)
        self.assertNotIn("intra_op_num_threads", kw)


if __name__ == "__main__":
    unittest.main()
