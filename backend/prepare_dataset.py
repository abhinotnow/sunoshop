# backend/prepare_dataset.py
# Streams a small slice of McAuley Amazon Reviews 2023 (raw .jsonl over HTTPS) and writes data/raw_subset.json.
# Run once by a developer: python backend/prepare_dataset.py. Never downloads a whole category.
import collections, json, os
import requests

BASE = "https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023/resolve/main/raw"
CAT = "Appliances"        # small and quick; later try Cell_Phones_and_Accessories
N_REVIEWS = 500_000       # review lines to scan (raise if too few products come out)
POOL, KEEP, PER = 300, 40, 30   # shortlist size, products kept, reviews kept per product
HEAD = {"Authorization": f"Bearer {os.environ['HF_TOKEN']}"} if os.environ.get("HF_TOKEN") else {}


def stream(url):
    """Yield one parsed JSON object per line, without saving the file. Stops cleanly on network errors."""
    try:
        with requests.get(url, stream=True, timeout=120, headers=HEAD) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue            # a cut-off or bad line: skip it
    except requests.RequestException as e:
        print("network problem, continuing with what we have:", e)


def best_image(m):
    """Return one usable image URL from either layout (dict of lists, or list of dicts), else None."""
    im = m.get("images")
    if isinstance(im, dict):
        for key in ("hi_res", "large", "thumb"):
            for url in im.get(key) or []:
                if url:
                    return url
    elif isinstance(im, list):
        for d in im:
            for key in ("hi_res", "large", "thumb"):
                if isinstance(d, dict) and d.get(key):
                    return d[key]
    return None


# Pass A: first N_REVIEWS reviews, grouped by parent_asin (the join key)
by_p = collections.defaultdict(list)
for i, r in enumerate(stream(f"{BASE}/review_categories/{CAT}.jsonl")):
    if i >= N_REVIEWS:
        break
    if not r.get("parent_asin") or not r.get("text"):
        continue
    by_p[r["parent_asin"]].append({
        "rating": r.get("rating"), "title": r.get("title"), "text": r["text"][:600],
        "timestamp": r.get("timestamp"), "user_id": r.get("user_id"),
        "verified_purchase": r.get("verified_purchase"), "helpful_vote": r.get("helpful_vote"),
        "parent_asin": r["parent_asin"], "synthetic": False, "lang": "en",
    })
pool = {p for p, _ in sorted(by_p.items(), key=lambda kv: -len(kv[1]))[:POOL]}
print(f"scanned reviews for {len(by_p)} products; shortlist {len(pool)}; "
      f"top review counts: {sorted((len(by_p[p]) for p in pool), reverse=True)[:10]}")

# Pass B: stream product metadata; keep shortlisted products that have a real price and an image
found = {}
for m in stream(f"{BASE}/meta_categories/meta_{CAT}.jsonl"):
    p = m.get("parent_asin")
    if p in pool:
        try:
            price = float(m.get("price"))
        except (TypeError, ValueError):
            continue                    # price missing ('None') -> skip product
        url = best_image(m)
        if price > 0 and url:
            found[p] = {**m, "price": price, "image_url": url}
    if len(found) == len(pool):
        break

# Join: attach each product's reviews, keep the most-reviewed KEEP products
top = sorted(found, key=lambda p: -len(by_p[p]))[:KEEP]
out = [{"meta": found[p], "reviews": by_p[p][:PER]} for p in top]
os.makedirs("data", exist_ok=True)
with open("data/raw_subset.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"saved {len(out)} products; reviews/product min "
      f"{min((len(o['reviews']) for o in out), default=0)}")