from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

from server import CATEGORIES, fetch_articles


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "dist"
SITE_FILES = (
    "index.html",
    "styles.css",
    "app.js",
    "app-config.js",
    "manifest.webmanifest",
    "service-worker.js",
    "icon.svg",
)


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    for filename in SITE_FILES:
        shutil.copy2(BASE_DIR / filename, OUTPUT_DIR / filename)

    categories = {
        category: fetch_articles(category, "")
        for category in CATEGORIES
    }
    news = {
        "categories": categories,
        "updatedAt": datetime.now().astimezone().isoformat(),
    }
    (OUTPUT_DIR / "news.json").write_text(
        json.dumps(news, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    count = sum(len(articles) for articles in categories.values())
    print(f"Built {OUTPUT_DIR} with {count} articles across {len(categories)} categories.")


if __name__ == "__main__":
    main()
