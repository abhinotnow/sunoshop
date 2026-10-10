# Validates the downloaded Amazon Reviews subset and probes sample product images.
# Exports a command-line checker that reports each dataset check as PASS or FAIL.
# Depends on Python's standard library and requests; reads data/raw_subset.json.

import json
import random
from pathlib import Path

import requests


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "raw_subset.json"
SAMPLE_TEXT_LENGTH = 180
REQUEST_TIMEOUT_SECONDS = 20


def report(name: str, passed: bool, details: str = "") -> bool:
    """Print one check result and return its pass state."""
    label = "PASS" if passed else "FAIL"
    suffix = f": {details}" if details else ""
    print(f"{label} {name}{suffix}")
    return passed


def image_layout(products: list[object]) -> None:
    """Print the observed Python type and keys for meta.images values."""
    layouts: set[str] = set()
    for product in products:
        if not isinstance(product, dict):
            continue
        meta = product.get("meta")
        if not isinstance(meta, dict) or "images" not in meta:
            continue
        images = meta["images"]
        if isinstance(images, dict):
            layouts.add(f"dict; keys={list(images.keys())!r}")
        elif isinstance(images, list):
            first_keys = list(images[0].keys()) if images and isinstance(images[0], dict) else []
            layouts.add(f"list; first-item keys={first_keys!r}")
        else:
            layouts.add(f"{type(images).__name__}; keys=n/a")
    print("meta['images'] layouts:")
    if layouts:
        for layout in sorted(layouts):
            print(f"  {layout}")
    else:
        print("  no meta.images values found")


def valid_meta(meta: object) -> bool:
    if not isinstance(meta, dict):
        return False
    price = meta.get("price")
    return (
        bool(meta.get("parent_asin"))
        and bool(meta.get("title"))
        and isinstance(price, float)
        and price > 0
        and isinstance(meta.get("image_url"), str)
        and meta["image_url"].startswith("http")
    )


def valid_reviews(product: dict[str, object]) -> bool:
    meta = product.get("meta")
    reviews = product.get("reviews")
    if not isinstance(meta, dict) or not isinstance(reviews, list) or len(reviews) < 10:
        return False
    asin = meta.get("parent_asin")
    for review in reviews:
        if not isinstance(review, dict):
            return False
        if "rating" not in review or not isinstance(review.get("text"), str) or not review["text"].strip():
            return False
        if review.get("parent_asin") != asin or review.get("synthetic") is not False or review.get("lang") != "en":
            return False
    return True


def print_samples(products: list[object]) -> None:
    print("Sample products:")
    for index, product in enumerate(products[:2], start=1):
        if not isinstance(product, dict):
            print(f"  {index}. malformed product: {product!r}")
            continue
        meta = product.get("meta")
        meta = meta if isinstance(meta, dict) else {}
        print(f"  {index}. title={meta.get('title')!r}")
        print(f"     price={meta.get('price')!r}")
        print(f"     image_url={meta.get('image_url')!r}")
        reviews = product.get("reviews")
        reviews = reviews if isinstance(reviews, list) else []
        for review_index, review in enumerate(reviews[:2], start=1):
            text = review.get("text") if isinstance(review, dict) else repr(review)
            text = text if isinstance(text, str) else repr(text)
            if len(text) > SAMPLE_TEXT_LENGTH:
                text = text[:SAMPLE_TEXT_LENGTH] + "..."
            print(f"     review {review_index}={text!r}")


def probe_images(products: list[object]) -> bool:
    urls = []
    for product in products:
        if not isinstance(product, dict):
            continue
        meta = product.get("meta")
        url = meta.get("image_url") if isinstance(meta, dict) else None
        if isinstance(url, str) and url.startswith("http") and url not in urls:
            urls.append(url)
    if len(urls) < 3:
        report("three random image URLs available", False, f"found {len(urls)}")
        return False

    selected = random.sample(urls, 3)
    all_ok = True
    for index, url in enumerate(selected, start=1):
        print(f"Image {index}: {url}")
        for method in ("HEAD", "GET"):
            try:
                if method == "HEAD":
                    response = requests.head(url, timeout=REQUEST_TIMEOUT_SECONDS, allow_redirects=True)
                else:
                    response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS, stream=True)
                status = response.status_code
                content_type = response.headers.get("content-type", "")
                response.close()
                print(f"  {method}: status={status}, content-type={content_type}")
                if status != 200 or not content_type.lower().startswith("image/"):
                    all_ok = False
            except requests.RequestException as error:
                print(f"  {method}: request error: {error}")
                all_ok = False
    report("three random images return 200 with image/* content-type", all_ok)
    return all_ok


def main() -> int:
    if not DATA_PATH.is_file():
        report("dataset file exists", False, str(DATA_PATH))
        return 1
    try:
        with DATA_PATH.open(encoding="utf-8") as data_file:
            products = json.load(data_file)
    except (OSError, json.JSONDecodeError) as error:
        report("dataset JSON loads", False, str(error))
        return 1

    if not isinstance(products, list):
        report("dataset is a product list", False, f"got {type(products).__name__}")
        return 1

    outcomes = []
    outcomes.append(report("at least 20 products", len(products) >= 20, f"found {len(products)}"))
    has_fields = all(
        isinstance(product, dict) and "meta" in product and "reviews" in product
        for product in products
    )
    outcomes.append(report("every item has meta and reviews", has_fields))
    outcomes.append(report("every meta has required fields", all(valid_meta(p.get("meta")) for p in products if isinstance(p, dict)) and has_fields))
    outcomes.append(report("every product has at least 10 valid English real reviews", all(valid_reviews(p) for p in products if isinstance(p, dict)) and has_fields))

    asins = [
        p["meta"].get("parent_asin")
        for p in products
        if isinstance(p, dict) and isinstance(p.get("meta"), dict)
    ]
    no_duplicates = len(asins) == len(set(asins))
    outcomes.append(report("no duplicate parent_asin across products", no_duplicates))

    image_layout(products)
    print_samples(products)
    outcomes.append(probe_images(products))

    passed = sum(outcomes)
    print(f"\nDataset checks: {passed}/{len(outcomes)} passed")
    return 0 if all(outcomes) else 1


if __name__ == "__main__":
    raise SystemExit(main())
