#!/usr/bin/env python3
"""Headless self-check for image-scraper (no browser, no network, no GUI).

Verifies the offline parts of the scraper:

* every ``sources/json/*.json`` source config is loaded and structurally sane,
* the JSON/HTML extraction pipeline (dotted paths, fallbacks, templates,
  filters, transforms) returns the expected values,
* ``meta`` store round-trip: run metadata and failed-URL lists land on disk
  with the documented shape (written into a temporary directory only).

Run from the project root:

    python selfcheck.py

Prints ``selfcheck ok: ...`` and returns 0 on success, ``FAIL: ...`` and 1
on failure.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path

from services import meta_store
from services.downloader import ImageTask, SourceStats
from sources.engine import (_apply_extractor, _apply_transforms, _check_filter,
                            _get_path, _subst, _to_int)
from sources.registry import ALL_SOURCES, _CONFIGS, JSON_DIR

# The project logs every meta write; keep self-check output clean on stderr.
logging.getLogger("mj_scraper").setLevel(logging.CRITICAL)

VALID_DRIVERS = {"http", "browser", "browser_html"}
CHECKS: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if not condition:
        raise AssertionError(f"{name}: {detail or 'condition is false'}")
    CHECKS.append(name)


def check_registry() -> None:
    check("registry.count", len(ALL_SOURCES) >= 25, len(ALL_SOURCES))
    json_files = sorted(JSON_DIR.glob("*.json"))
    check("registry.files", len(ALL_SOURCES) == len(json_files),
          f"{len(ALL_SOURCES)} sources vs {len(json_files)} json files")
    check("registry.keys", set(ALL_SOURCES) == set(_CONFIGS))
    check("registry.unique", len(ALL_SOURCES) == len(set(ALL_SOURCES)))

    for name in ALL_SOURCES:
        cfg = _CONFIGS[name]
        check(f"registry.name.{name}", cfg.get("name") == name, repr(cfg.get("name")))
        check(f"registry.driver.{name}", cfg.get("driver") in VALID_DRIVERS,
              repr(cfg.get("driver")))
        if cfg.get("driver") == "http":
            check(f"registry.url.{name}", bool(cfg.get("item", {}).get("url")),
                  "http source without item.url")


def check_extraction() -> None:
    item = {"assets": [{"image_url": "https://cdn.test/a.png"}],
            "title": "Hello", "width": "1,024"}

    check("extract.path", _get_path(item, "assets.0.image_url") == "https://cdn.test/a.png")
    check("extract.missing", _get_path(item, "assets.9.image_url") is None)
    check("extract.path_direct",
          _apply_extractor({"path": "assets.0.image_url"}, item, {}) == "https://cdn.test/a.png")
    check("extract.fallback",
          _apply_extractor({"path": "nope", "fallback": {"const": "https://fall.back/x.jpg"}},
                           item, {}) == "https://fall.back/x.jpg")
    check("extract.template",
          _apply_extractor({"template": "{title}-{page}"}, item, {"page": 3}) == "Hello-3")
    check("extract.default",
          _apply_extractor({"default": [{"path": "nope"}, {"const": "dflt"}]}, item, {}) == "dflt")

    check("filter.image", _check_filter({"is_image": True}, "https://a/b.JPG?x=1", {}))
    check("filter.page_rejected", not _check_filter({"is_image": True}, "https://a/page.html", {}))
    check("to_int.thousands", _to_int("1,234") == 1234)
    check("to_int.default", _to_int("bad", 7) == 7)
    check("subst.known", _subst("{a}/{z}", {"a": 1}) == "1/{z}")
    check("transforms.regex", _apply_transforms(
        "abc123", [{"op": "regex_replace", "pattern": r"\d+", "repl": "#"}], {}) == "abc#")
    check("transforms.chain", _apply_transforms(
        "HTTPS://X/A.PNG", [{"op": "lower"}, {"op": "append_query", "value": "?w=1"}], {})
        == "https://x/a.png?w=1")
    check("transforms.to_int", _apply_transforms("12,345", [{"op": "to_int"}], {}) == 12345)


def check_meta_store() -> None:
    with tempfile.TemporaryDirectory(prefix="image-scraper-selfcheck-") as tmp:
        local = os.path.join(tmp, "images", "selfcheck.png")
        done = ImageTask(url="https://cdn.test/a.png", source="selfcheck",
                         title="t", author="a", width=10, height=20,
                         local_path=local, downloaded=True, meta={"k": "v"})
        pending = ImageTask(url="https://cdn.test/b.png", source="selfcheck",
                            downloaded=False)
        stats = SourceStats(fetched=2, downloaded=1, skipped=1, errors=0,
                            start_time=1.0, end_time=2.0)

        meta_path = meta_store.save_meta(tmp, "selfcheck", [done, pending], stats)
        check("meta.file", meta_path.exists() and meta_path.parent == Path(tmp))
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        check("meta.fields",
              data.get("source") == "selfcheck" and data.get("timestamp")
              and data.get("stats", {}).get("downloaded") == 1, data.get("stats"))
        check("meta.images", len(data.get("images", [])) == 1, data.get("images"))
        image = data["images"][0]
        check("meta.image_url", image.get("url") == "https://cdn.test/a.png")
        check("meta.filename", image.get("filename") == "selfcheck.png", image.get("filename"))
        check("meta.extra", image.get("meta") == {"k": "v"})

        failed_path = meta_store.save_failed(
            tmp, "selfcheck", [{"url": "https://cdn.test/x.jpg", "referer": "r"}])
        check("failed.file", failed_path.exists())
        failed = json.loads(failed_path.read_text(encoding="utf-8"))
        check("failed.count", failed.get("count") == 1, failed.get("count"))
        check("failed.task", failed.get("tasks", [{}])[0].get("url") == "https://cdn.test/x.jpg")


def run() -> None:
    check_registry()
    check_extraction()
    check_meta_store()


def main() -> int:
    try:
        run()
    except Exception as exc:  # noqa: BLE001 - self-check must report, not traceback
        print(f"FAIL: {type(exc).__name__}: {exc}")
        return 1
    print(f"selfcheck ok: image-scraper offline core "
          f"({len(CHECKS)} checks: registry/extract/meta)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
