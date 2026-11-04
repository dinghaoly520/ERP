"""Task 1 单测：OCR 引擎细粒度配置解析（线程/worker）。

线程铁律：OCR_NUM_WORKERS × OCR_INTRA_THREADS ≤ 分配给 OCR 的核预算。
"""
import unittest

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


if __name__ == "__main__":
    unittest.main()
