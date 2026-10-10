# SunoShop Backend Contract (Draft for SYNC-A)

This contract describes the Product Knowledge Object (PKO) and JSON WebSocket messages
shared by the backend and frontend. It follows the Amazon Reviews 2023 field names in
`docs/ARCHITECTURE.md` section 13. This draft needs Member 2's review before SYNC-A is
considered frozen.

## General rules

- Each WebSocket message is one JSON object with a `type` discriminator.
- Audio is standard Base64 text without a `data:` URL prefix, encoded as `audio_base64`.
- Client audio is a WAV file, mono, 16 kHz, at most 20 seconds, and under 5 MB before
  Base64 encoding. The server decodes it before calling AnuvaadHub ASR.
- Server audio is a WAV returned by AnuvaadHub TTS, downloaded and cached by the backend,
  then Base64 encoded for `reply.sentence`.
- `rate` is a playback rate. The browser applies it; AnuvaadHub TTS has no rate parameter.
- The session language is one of `en`, `hi`, or `te` and does not change during a session.

## Product Knowledge Object

The PKO retains the source product and review field names. `price` remains the source USD
price; `price_inr` is the rounded INR value generated with the project's declared fixed
conversion rate. Source fields that may be absent in a category are nullable or have an
empty-list default in the Pydantic model.

| Field | Type | Meaning |
|---|---|---|
| `parent_asin` | string | Amazon product identifier |
| `title` | string | Product title |
| `price` | positive number | Source price in USD |
| `features` | string array | Source product features |
| `description` | string array | Source description |
| `images` | image array | Source image objects (`thumb`, `large`, `variant`, `hi_res`) |
| `store` | string or null | Source store |
| `average_rating` | number or null | Source average rating |
| `rating_number` | integer or null | Source rating count |
| `categories` | string array | Source category path |
| `details` | object | Source product details |
| `main_category` | string or null | Additional source category field |
| `videos` | object array | Additional source video metadata |
| `bought_together` | string array or null | Additional source related-product field |
| `price_inr` | positive integer | Rounded price in Indian rupees |
| `image_url` | string or null | Selected usable product image URL |
| `alt_text` | object | `en`, `hi`, and `te` descriptions |
| `review_digest` | object | `pros` and `cons` string arrays |
| `size_chart` | object array | Normalized size information, empty when unavailable |
| `reviews` | review array | Source review fields plus `synthetic` and `lang` |
| `review_chunks` | object array | Aspect, text, and optional embedding for retrieval |

Each review has `rating`, `title`, `text`, `timestamp`, `verified_purchase`, `helpful_vote`,
`user_id`, and `parent_asin`, retaining the dataset's names. SunoShop adds `synthetic` and
`lang`, where `lang` is `en`, `hi`, `te`, or `hi-en`.

Example PKO:

```json
{
  "parent_asin": "B09CBF2XCF",
  "title": "Coffee scoop",
  "price": 8.99,
  "features": ["Integrated funnel"],
  "description": [],
  "images": [{"thumb": "https://example.com/thumb.jpg", "large": "https://example.com/item.jpg", "variant": "MAIN", "hi_res": null}],
  "store": "Example Store",
  "average_rating": 4.5,
  "rating_number": 100,
  "categories": ["Kitchen", "Coffee"],
  "details": {},
  "main_category": "Home & Kitchen",
  "videos": [],
  "bought_together": null,
  "price_inr": 749,
  "image_url": "https://example.com/item.jpg",
  "alt_text": {"en": "A metal coffee scoop.", "hi": "एक धातु का कॉफी स्कूप।", "te": "లోహపు కాఫీ స్కూప్."},
  "review_digest": {"pros": ["Easy to use"], "cons": []},
  "size_chart": [],
  "reviews": [{"rating": 5, "title": "Useful", "text": "Works well.", "timestamp": 1710000000, "verified_purchase": true, "helpful_vote": 1, "user_id": "user-1", "parent_asin": "B09CBF2XCF", "synthetic": false, "lang": "en"}],
  "review_chunks": [{"aspect": "usability", "text": "Works well.", "embedding": []}]
}
```

## Client to server messages

| `type` | Required fields | Notes |
|---|---|---|
| `session.start` | `lang`, `mode`, `rate` | `lang`: `en`/`hi`/`te`; `mode`: `push_to_talk`/`auto`; `rate` is greater than 0 and at most 2. |
| `audio.utterance` | `audio_base64`, `content_type`, `sample_rate_hz`, `channels`, `duration_ms` | WAV; content type `audio/wav`; 16000 Hz; mono; duration 1–20000 ms. |
| `ui.event` | `kind` | One of `tap_miss`, `asr_timeout`, `explain_again`. |
| `checkout.action` | `action`, optionally `audio_base64` | `action`: `start`, `confirm_audio`, or `cancel`; `confirm_audio` requires audio. |

## Server to client messages

| `type` | Required fields | Notes |
|---|---|---|
| `asr.result` | `text`, `plausible` | Transcript and plausibility result. |
| `check_again` | `reason` | ASR needs another attempt. |
| `reply.sentence` | `idx`, `text`, `audio_base64`, `content_type`, `pause_ms`, `rate` | Zero-based order; WAV audio; apply `rate` and pause before the next sentence. |
| `reply.done` | `grounded` | Indicates whether the complete answer passed grounding checks. |
| `shelf.results` | `products` | At most 3 entries; each has `parent_asin`, `title`, `price_inr`, `pan` (-1 to 1), and localized `alt_text`. |
| `checkout.state` | `state`, `cart`, `total_inr`, `removed_fees` | State is `BROWSING`, `CART_REVIEW`, `GUARDED`, `AWAITING_CONFIRM`, or `ORDER_PLACED`. |
| `confirm.challenge` | `phrase`, `lang`, `attempts_remaining` | Phrase must be spoken back for confirmation. |
| `adapt.offer` | `adaptation`, `reason` | Adaptation is `larger_targets` or `slower_speech`; apply only after user consent. |
| `error` | `code`, `fallback` | `fallback` is `retry` or `offline`. |

### Checkout item fields

- Cart items: `parent_asin`, `title`, positive `quantity`, `unit_price_inr`, and `total_price_inr`.
- Removed fees: `name` and positive `amount_inr`.
- Checkout totals are in INR and must reflect only the guarded cart after unwanted fees are removed.

## Pydantic model exports

`backend/models.py` defines `ProductKnowledgeObject`, `ProductReview`, `ClientMessage`, and
`ServerMessage`, plus the concrete message and nested payload models used by each union.
