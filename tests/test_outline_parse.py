import sys
from pathlib import Path

_CORE = Path(__file__).resolve().parents[1] / "core"
if str(_CORE) not in sys.path:
    sys.path.insert(0, str(_CORE))

from orchestrator import parse_book_outline  # noqa: E402


def test_parse_book_outline_reads_russian_headings():
    text = """# План

## Глава 1 — Порог
От лица: Мира
Мира находит закрытую границу и не решается шагнуть.

## Глава 2 — Проводник
От лица: Мира
Ночной рынок предлагает ей имя, которого нет на картах.
"""
    chapters = parse_book_outline(text)
    assert [c["number"] for c in chapters] == [1, 2]
    assert chapters[0]["title"] == "Порог"
    assert chapters[0]["pov"] == "Мира"
    assert "закрытую границу" in chapters[0]["synopsis"]
    assert "Ночной рынок" in chapters[1]["synopsis"]
