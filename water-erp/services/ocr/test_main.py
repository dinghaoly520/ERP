import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))

import main


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


if __name__ == "__main__":
    unittest.main()
