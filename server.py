from __future__ import annotations

import json
import logging
import os
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen


HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))
CACHE_SECONDS = 180
MAX_ITEMS = 30
FEED_URL = "https://news.google.com/rss/search"
BASE_DIR = Path(__file__).resolve().parent
CATEGORIES = {
    "all": "AI OR artificial intelligence OR 生成AI OR 人工知能",
    "generative": "生成AI OR generative AI OR ChatGPT OR Gemini",
    "business": "AI 企業 OR AI ビジネス OR 人工知能 企業",
    "research": "AI 研究 OR 人工知能 研究 OR machine learning research",
    "japan": "AI 日本 OR 生成AI 日本 OR 人工知能 国内",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_cache_lock = threading.Lock()


def parse_feed(xml_data: bytes) -> list[dict[str, Any]]:
    """Convert a Google News RSS response into JSON-ready article records."""
    root = ET.fromstring(xml_data)
    articles: list[dict[str, Any]] = []

    for item in root.findall("./channel/item")[:MAX_ITEMS]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue

        source_node = item.find("source")
        source = (source_node.text or "").strip() if source_node is not None else ""
        published: str | None = None
        pub_date = item.findtext("pubDate")
        if pub_date:
            try:
                published = parsedate_to_datetime(pub_date).isoformat()
            except (TypeError, ValueError, OverflowError):
                published = None

        articles.append(
            {
                "title": title,
                "link": link,
                "source": source,
                "publishedAt": published,
            }
        )

    return articles


def fetch_articles(category: str, query: str) -> list[dict[str, Any]]:
    cache_key = f"{category}:{query.casefold()}"
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

    search_terms = CATEGORIES[category]
    if query:
        search_terms = f"({search_terms}) {query}"
    url = f"{FEED_URL}?{urlencode({'q': search_terms, 'hl': 'ja', 'gl': 'JP', 'ceid': 'JP:ja'})}"
    request = Request(url, headers={"User-Agent": "AI-News-JP/1.0"})
    with urlopen(request, timeout=12) as response:
        articles = parse_feed(response.read())

    with _cache_lock:
        _cache[cache_key] = (now + CACHE_SECONDS, articles)
    return articles


class NewsHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed_url = urlsplit(self.path)
        if parsed_url.path == "/api/news":
            self._serve_news(parse_qs(parsed_url.query))
            return

        static_files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/index.html": ("index.html", "text/html; charset=utf-8"),
            "/styles.css": ("styles.css", "text/css; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/app-config.js": ("app-config.js", "text/javascript; charset=utf-8"),
            "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json; charset=utf-8"),
            "/service-worker.js": ("service-worker.js", "text/javascript; charset=utf-8"),
            "/icon.svg": ("icon.svg", "image/svg+xml"),
        }
        file_info = static_files.get(parsed_url.path)
        if file_info is None:
            self.send_error(404, "Not found")
            return

        filename, content_type = file_info
        try:
            if filename == "app-config.js":
                content = b'window.AI_NEWS_CONFIG = { mode: "live" };\n'
            else:
                with (BASE_DIR / filename).open("rb") as file:
                    content = file.read()
        except OSError:
            logging.exception("Could not read static file: %s", filename)
            self.send_error(500, "Could not read application file")
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        if parsed_url.path == "/service-worker.js":
            self.send_header("Service-Worker-Allowed", "/")
        self.end_headers()
        self.wfile.write(content)

    def _serve_news(self, params: dict[str, list[str]]) -> None:
        category = params.get("category", ["all"])[0]
        query = params.get("q", [""])[0].strip()[:120]
        if category not in CATEGORIES:
            self._send_json(400, {"error": "指定されたカテゴリは利用できません。"})
            return

        try:
            articles = fetch_articles(category, query)
        except (URLError, TimeoutError, ET.ParseError, OSError) as error:
            logging.warning("Could not fetch Google News RSS: %s", error)
            self._send_json(
                502,
                {"error": "ニュースを取得できませんでした。時間をおいて再度お試しください。"},
            )
            return

        self._send_json(
            200,
            {
                "articles": articles,
                "category": category,
                "query": query,
                "updatedAt": datetime.now().astimezone().isoformat(),
            },
        )

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format_string: str, *args: object) -> None:
        logging.info("%s - %s", self.address_string(), format_string % args)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), NewsHandler)
    logging.info("AI News is running at http://%s:%s", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Stopping AI News server")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
