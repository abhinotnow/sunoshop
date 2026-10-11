# backend/prepare_dataset.py
# Streams a small slice of McAuley Amazon Reviews 2023 (raw .jsonl over HTTPS), joins reviews to products
# on parent_asin, and writes data/raw_subset_<Category>.json. Never downloads a whole category.
# Usage: python backend/prepare_dataset.py [Category] [keep] [n_reviews]
#   e.g. python backend/prepare_dataset.py Cell_Phones_and_Accessories 60
import collections, json, os, sys
import requests

BASE = "https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023/resolve/main/raw"
CAT = sys.argv[1] if len(sys.argv) > 1 else "Appliances"       # must match the file name exactly
KEEP = int(sys.argv[2]) if len(sys.argv) > 2 else 40           # how many products to save
N_REVIEWS = int(sys.argv[3]) if len(sys.argv) > 3 else 500_000 # review lines to scan
POOL = KEEP * 8        # shortlist; larger than KEEP because some lose out (no price / no image)
PER = 30               # reviews kept per product
OUT = f"data/raw_subset_{CAT}.json"
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
print(f"[{CAT}] scanned reviews for {len(by_p)} products; shortlist {len(pool)}; "
      f"top review counts: {sorted((len(by_p[p]) for p in pool), reverse=True)[:10]}")

# Pass B: stream product metadata; keep shortlisted products that have a real price and an image
found, seen = {}, 0
for m in stream(f"{BASE}/meta_categories/meta_{CAT}.jsonl"):
    p = m.get("parent_asin")
    if p in pool:
        seen += 1
        try:
            price = float(m.get("price"))
        except (TypeError, ValueError):
            price = None                # price missing ('None') -> skip product
        url = best_image(m)
        if price and price > 0 and url:
            found[p] = {**m, "price": price, "image_url": url}
    if len(found) >= KEEP * 2 or seen == len(pool):   # enough candidates, or shortlist fully seen
        break

# Join: attach each product's reviews, keep the most-reviewed KEEP products
top = sorted(found, key=lambda p: -len(by_p[p]))[:KEEP]
out = [{"category": CAT, "meta": found[p], "reviews": by_p[p][:PER]} for p in top]
os.makedirs("data", exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"saved {len(out)} products to {OUT}; reviews/product min "
      f"{min((len(o['reviews']) for o in out), default=0)}")