"""Crawl providers.

``httpx_crawler`` is the built-in default (standard-library HTML parsing).
``firecrawl`` is the optional external provider. Both expose ``fetch_page``/
``scrape`` returning a ``CrawledPage`` from ``app.services.web_crawler``.
"""
