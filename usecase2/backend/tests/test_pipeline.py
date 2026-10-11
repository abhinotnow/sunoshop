# Test entity masking across English, Hindi, and Telugu.
# Exports pipeline, shelf search, grounding, simplification, chunking, and ASR tests.
# Depends on pytest and backend.pipeline.

from backend.pipeline import (
    NO_INFORMATION,
    answer_grounded,
    check_grounded,
    chunk_sentences,
    compare_claim_experience,
    is_plausible_asr,
    handle_utterance,
    mask,
    parse_price_limit,
    retrieve,
    route,
    search_shelf,
    simplify_answer,
    unmask,
    _answer_context,
)
from backend import bhashini
from textstat import textstat


SAMPLES = [
    ("Is the Samsung Galaxy S24 worth $799?", ["Samsung Galaxy S24"]),
    ("Compare Redmi Note 13 at ₹14,999 with OnePlus Nord.", ["Redmi Note 13", "OnePlus Nord"]),
    ("Does SM-A546E have 128 GB storage?", []),
    ("I need a phone under 15000.", []),
    ("Is a 5.5 Ah battery enough?", []),
    ("Find iPhone 15 Pro for USD 999.99.", ["iPhone 15 Pro"]),
    ("Samsung has 2 reviews and costs Rs 12,500.", ["Samsung"]),
    ("Can the X1000 run 3 apps?", []),
    ("क्या Samsung Galaxy S24 ₹79,999 में अच्छा है?", ["Samsung Galaxy S24"]),
    ("Redmi Note 13 में 128 GB स्टोरेज है?", ["Redmi Note 13"]),
    ("OnePlus Nord की कीमत Rs 15,000 है।", ["OnePlus Nord"]),
    ("क्या 5 Ah बैटरी काफी है?", []),
    ("फोन 15 हजार के अंदर चाहिए।", []),
    ("क्या SM-A546E में 2 सिम हैं?", []),
    ("Samsung की रेटिंग 4.5 है।", ["Samsung"]),
    ("मेरे पास ₹1,299 हैं।", []),
    ("Samsung Galaxy S24 ధర ₹79,999 అయితే బాగుంటుందా?", ["Samsung Galaxy S24"]),
    ("Redmi Note 13 లో 128 GB స్టోరేజ్ ఉందా?", ["Redmi Note 13"]),
    ("OnePlus Nord ధర Rs 15,000 ఎంత?", ["OnePlus Nord"]),
    ("5 Ah బ్యాటరీ సరిపోతుందా?", []),
    ("రూ. 15000 లోపు ఫోన్ చూపించు।", []),
    ("SM-A546E లో 2 సిమ్‌లు ఉన్నాయా?", []),
    ("Samsung రేటింగ్ 4.5 ఉందా?", ["Samsung"]),
    ("ఈ ఫోన్ $99.99 కు సరిపోతుందా?", []),
]


def test_round_trip_preserves_entities_in_english_hindi_and_telugu():
    assert len(SAMPLES) > 20
    for original, known_entities in SAMPLES:
        masked, entity_map = mask(original, known_entities)
        assert entity_map, original
        assert unmask(masked, entity_map) == original


def test_entities_survive_when_surrounding_words_are_reordered():
    for original, known_entities in SAMPLES:
        masked, entity_map = mask(original, known_entities)
        scrambled = " ".join(reversed(masked.split()))
        expected = scrambled
        for token, value in entity_map.items():
            expected = expected.replace(token, value)
        restored = unmask(scrambled, entity_map)
        assert restored == expected
        assert all(value in restored for value in entity_map.values())


def test_mask_categories_and_unicode_digits():
    masked, entity_map = mask("Samsung Galaxy S24 costs ₹७९९", ["Samsung Galaxy S24"])
    assert "[PROD_1]" in masked
    assert "[PRICE_1]" in masked
    assert set(entity_map.values()) == {"Samsung Galaxy S24", "₹७९९"}


def test_unmask_leaves_unknown_placeholders_intact():
    assert unmask("[PRICE_1] [PRICE_2]", {"[PRICE_1]": "$10"}) == "$10 [PRICE_2]"


def test_route_maps_commands_and_paraphrases_without_network_or_llm():
    cases = [
        ("repeat", "repeat"),
        ("Could you repeat that?", "repeat"),
        ("say that again", "repeat"),
        ("slow down", "slower"),
        ("Talk more slowly!", "slower"),
        ("speak slower", "slower"),
        ("simpler", "simpler"),
        ("Explain in simple words", "simpler"),
        ("make that easier to understand", "simpler"),
        ("track order", "track_order"),
        ("Where is my package?", "track_order"),
        ("delivery status", "track_order"),
        ("checkout", "checkout"),
        ("Proceed to checkout", "checkout"),
        ("I said: buy now!", "rag"),
        ("cancel", "cancel"),
        ("Cancel my order.", "cancel"),
        ("never mind", "cancel"),
        ("What is the camera quality?", "rag"),
        ("Compare Samsung and Redmi", "rag"),
    ]
    for text, expected in cases:
        assert route(text) == expected, text


def test_route_normalizes_case_unicode_and_punctuation():
    assert route("  PLEASE, SLOW DOWN!!  ") == "slower"
    assert route("ＲＥＰＥＡＴ") == "repeat"


def test_retrieve_returns_exact_spec_and_top_cosine_review_chunks():
    pko = {
        "parent_asin": "p_001",
        "title": "Demo phone",
        "details": {"Battery": {"capacity": "5000 mAh"}, "Color": "Black"},
        "review_chunks": [
            {"aspect": "battery", "text": "Battery lasts all day.", "embedding": [1.0, 0.0]},
            {"aspect": "camera", "text": "Photos look clear.", "embedding": [0.0, 1.0]},
            {"aspect": "battery", "text": "Battery charges quickly.", "embedding": [0.8, 0.2]},
        ],
    }
    result = retrieve("battery of p_001", [pko], query_embedding=[1.0, 0.0], top_k=2)

    assert result["product"] is pko
    assert result["specs"] == {"Battery": {"capacity": "5000 mAh"}}
    assert [chunk["text"] for chunk in result["review_chunks"]] == [
        "Battery lasts all day.",
        "Battery charges quickly.",
    ]


def test_retrieve_handles_model_objects_and_missing_product_or_embedding():
    pko = type(
        "PKO",
        (),
        {
            "parent_asin": "p_001",
            "title": "Demo phone",
            "details": {"Battery": "5000 mAh"},
            "review_chunks": [
                type("Chunk", (), {"aspect": "battery", "text": "Long life", "embedding": [1.0, 0.0]})()
            ],
        },
    )()
    assert retrieve("battery", [pko])["review_chunks"] == []
    assert retrieve("battery of p_999", [pko], [1.0, 0.0])["product"] is None


def test_check_grounded_accepts_supported_claim_and_rejects_new_number_or_claim():
    evidence = "Battery capacity is 5000 mAh. Reviews say battery lasts all day."
    assert check_grounded("Battery capacity is 5000 mAh.", evidence) == "Battery capacity is 5000 mAh."
    assert check_grounded("Battery capacity is 6000 mAh.", evidence) == NO_INFORMATION
    assert check_grounded("Battery capacity is excellent.", evidence) == NO_INFORMATION


def test_retrieve_uses_matching_dataset_features_and_allows_supported_paraphrase():
    product = {
        "parent_asin": "p_001",
        "title": "Demo coffee scoop",
        "features": [
            "Includes the coffee scoop only; reusable K-Cup coffee filter sold separately.",
            "Works with reusable coffee pods.",
        ],
    }

    evidence = retrieve("Does the p_001 coffee scoop include the reusable filter?", [product])
    answer = check_grounded(
        "Based on the provided evidence, no. The reusable K-Cup coffee filter is sold separately.",
        evidence,
    )

    assert evidence["product"] is product
    assert evidence["features"] == product["features"]
    assert answer.startswith("Based on the provided evidence")
    assert check_grounded("It includes a stainless steel filter.", evidence) == NO_INFORMATION


def test_grounding_accepts_spelled_number_only_when_dataset_has_matching_digit():
    evidence = "Samsung Genuine Filters, 3 Pack."

    assert check_grounded("The genuine Samsung three-pack.", evidence) != NO_INFORMATION
    assert check_grounded("This filter has three stages.", evidence) == NO_INFORMATION


def test_image_description_is_available_as_visual_question_evidence():
    product = {
        "parent_asin": "p_001",
        "title": "Demo product",
        "alt_text": {
            "en": "A black coffee scoop on a white background.",
            "hi": "सफेद पृष्ठभूमि पर काला कॉफी स्कूप।",
            "te": "తెల్లని నేపథ్యంపై నల్ల కాఫీ స్కూప్.",
        },
        "images": [{
            "variant": "MAIN",
            "alt_text": {"en": "A black coffee scoop on a white background."},
        }],
    }

    context = _answer_context({"product": product, "specs": {}, "features": [], "review_chunks": []})

    assert "MAIN image: A black coffee scoop on a white background." in context
    assert check_grounded("The image shows a black coffee scoop on a white background.", context) != NO_INFORMATION
    assert check_grounded("The image shows a person holding the scoop.", context) == NO_INFORMATION


def test_retrieve_does_not_guess_between_multiple_vague_products():
    products = [
        {"parent_asin": "a", "title": "Coffee scoop", "features": ["Metal scoop"]},
        {"parent_asin": "b", "title": "Coffee filter", "features": ["Paper filter"]},
    ]

    result = retrieve("Does this include the filter?", products)

    assert result["product"] is None
    assert result["features"] == []


def test_empty_retrieval_fails_closed_without_calling_gemini(monkeypatch):
    monkeypatch.setattr(
        "backend.pipeline.requests.post",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected API call")),
    )

    result = retrieve("unknown product", [{"parent_asin": "known", "title": "Known item"}])
    assert answer_grounded("What is this?", result, api_key="test-key") == NO_INFORMATION


def test_claim_experience_marks_bad_battery_reviews_as_contradicted():
    result = compare_claim_experience(
        "2-day battery",
        {"pros": ["Camera takes clear photos."], "cons": ["Battery drains quickly and lasts poorly."]},
    )

    assert result == {
        "claim": "2-day battery",
        "status": "contradicted",
        "supporting_reviews": [],
        "contradicting_reviews": ["Battery drains quickly and lasts poorly."],
    }


def test_claim_experience_reports_supported_mixed_and_insufficient_evidence():
    assert compare_claim_experience(
        "battery life", {"pros": ["Battery lasts all day."], "cons": []}
    )["status"] == "supported"
    assert compare_claim_experience(
        "battery life",
        {"pros": ["Battery lasts all day."], "cons": ["Battery drains quickly."]},
    )["status"] == "mixed"
    no_matching_evidence = compare_claim_experience(
        "battery life", {"pros": ["Camera takes clear photos."], "cons": []}
    )
    assert no_matching_evidence["status"] == "mixed"
    assert no_matching_evidence["supporting_reviews"] == []
    assert no_matching_evidence["contradicting_reviews"] == []


def test_price_limit_parser_handles_english_hindi_and_telugu():
    assert parse_price_limit("Show phones under 15,000") == 15000
    assert parse_price_limit("15000 से कम में फोन दिखाओ") == 15000
    assert parse_price_limit("15000 లోపు ఫోన్లు చూపించు") == 15000
    assert parse_price_limit("15000 or less") == 15000
    assert parse_price_limit("Show me a phone") is None


def test_search_shelf_filters_inr_ranks_top_three_and_localizes_alt_text():
    products = [
        {"parent_asin": "a", "title": "Phone alpha", "price_inr": 14999, "average_rating": 4.2,
         "alt_text": {"en": "Alpha phone", "hi": "अल्फा फोन", "te": "ఆల్ఫా ఫోన్"}},
        {"parent_asin": "b", "title": "Phone beta", "price_inr": 15000, "average_rating": 5.0,
         "alt_text": {"en": "Beta phone"}},
        {"parent_asin": "c", "title": "Phone gamma", "price_inr": 1000, "average_rating": 3.5,
         "alt_text": {"en": "Gamma phone"}},
        {"parent_asin": "d", "title": "Camera", "price_inr": 4000, "average_rating": 5.0,
         "alt_text": {"en": "Camera"}},
        {"parent_asin": "e", "title": "Phone with source-only price", "price": 8.0},
    ]

    event = search_shelf("phones under 15000", products, lang="te", top_k=10)

    assert event["type"] == "shelf.results"
    assert [product["parent_asin"] for product in event["products"]] == ["a", "c", "d"]
    assert [product["pan"] for product in event["products"]] == [-1.0, 0.0, 1.0]
    assert event["products"][0]["alt_text"] == "ఆల్ఫా ఫోన్"
    assert all(product["price_inr"] < 15000 for product in event["products"])


def test_utterance_emits_shelf_results_for_a_price_limited_search(monkeypatch):
    products = [{
        "parent_asin": "p_001", "title": "Demo phone", "price_inr": 12000,
        "alt_text": {"en": "A demo phone."},
    }]
    monkeypatch.setattr(bhashini, "recognize_speech", lambda _audio, _lang: "phones under 15000")
    monkeypatch.setattr(bhashini, "synthesize_speech", lambda _text, _lang: b"mock-wave-bytes")

    events = handle_utterance(b"mock-wave-bytes", "en", products)

    assert events[1]["type"] == "shelf.results"
    assert events[1]["products"][0]["parent_asin"] == "p_001"


def test_answer_grounded_sends_only_retrieved_facts_and_checks_model_output(monkeypatch):
    product = {
        "parent_asin": "p_001",
        "title": "Demo phone",
        "price": 99.0,
        "details": {"Battery": "5000 mAh"},
        "review_chunks": [{"aspect": "battery", "text": "Lasts all day.", "embedding": [0.1, 0.2]}],
    }
    retrieval = {
        "product": product,
        "specs": {"Battery": "5000 mAh"},
        "review_chunks": [{"aspect": "battery", "text": "Lasts all day.", "score": 0.9}],
    }
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "Battery is 5000 mAh."}]}}]}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return Response()

    monkeypatch.setattr("backend.pipeline.requests.post", fake_post)
    answer = answer_grounded("What is the battery capacity?", retrieval, api_key="test-key")

    assert answer == "Battery is 5000 mAh."
    body = captured["json"]["contents"][0]["parts"][0]["text"]
    assert "Lasts all day." in body
    assert "embedding" not in body
    assert captured["headers"]["x-goog-api-key"] == "test-key"


def test_answer_grounded_falls_back_without_key_or_on_unsupported_response(monkeypatch):
    retrieval = {"product": {"title": "Demo phone"}, "specs": {"Battery": "5000 mAh"}, "review_chunks": []}
    assert answer_grounded("What is its battery?", retrieval, api_key="") == NO_INFORMATION

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "It has a 7000 mAh battery."}]}}]}

    monkeypatch.setattr("backend.pipeline.requests.post", lambda *args, **kwargs: Response())
    assert answer_grounded("What is its battery?", retrieval, api_key="test-key") == NO_INFORMATION


def test_chunk_sentences_respects_word_limit_and_sentence_boundaries():
    long_sentence = " ".join(f"word{index}" for index in range(1, 31)) + "."
    chunks = chunk_sentences(f"First sentence. {long_sentence} दूसरा वाक्य।")
    assert chunks[0] == "First sentence."
    assert len(chunks) == 4
    assert all(len(chunk.split()) <= 25 for chunk in chunks)
    assert chunks[-1] == "दूसरा वाक्य।"


def test_chunk_sentences_rejects_nonpositive_limit():
    try:
        chunk_sentences("A sentence.", max_words=0)
    except ValueError as error:
        assert str(error) == "max_words must be at least 1"
    else:
        raise AssertionError("expected ValueError")


def test_asr_plausibility_flags_silence_symbols_and_obvious_gibberish():
    for text in ("", "   ", "!!!", "12345", "asdfghjkl", "aaaaaaa", "x x x"):
        assert not is_plausible_asr(text), text


def test_asr_plausibility_accepts_english_hindi_telugu_and_short_commands():
    for text in ("Show battery details", "I", "मुझे जानकारी चाहिए", "బ్యాటరీ వివరాలు చెప్పండి"):
        assert is_plausible_asr(text), text


def test_simpler_wording_lowers_textstat_grade_on_ten_samples():
    samples = [
        "The product demonstrates excellent compatibility and sufficient durability for everyday use.",
        "The device provides additional assistance for numerous household tasks.",
        "Users can utilize this product to commence their daily routines.",
        "The purchase may require approximately five minutes to complete.",
        "This beneficial feature demonstrates improved performance during normal operation.",
        "The product has sufficient capacity and provides additional storage for users.",
        "The instructions require assistance from an experienced technician.",
        "Numerous customers describe the device as beneficial and reliable.",
        "The system demonstrates compatibility with several common accessories.",
        "The product provides sufficient support and durability for regular use.",
    ]
    assert len(samples) == 10
    for original in samples:
        simpler = simplify_answer(original)
        assert textstat.flesch_kincaid_grade(simpler) < textstat.flesch_kincaid_grade(original)
