from backend.app.services.text_utils import (chunk_words, digit_sequences, digits_to_ascii, fuzzy_eq,
                                              normalize_route, route_tokens, sanitize_for_tts, script_ok)


def test_normalize_route():
    assert normalize_route("2 1 8") == "218"
    assert normalize_route("218d") == "218D"
    assert normalize_route("2O1") == "201"
    assert normalize_route("౨౧౮") == "218"


def test_native_digits():
    assert digits_to_ascii("బస్సు ౨౧౮") == "బస్సు 218"
    assert digit_sequences("बस २१८ और 5") == ["218", "5"]


def test_route_tokens_from_ocr():
    toks = route_tokens("ROUTE 218 TO KOTI\n10H MEHDIPATNAM 5K/M")
    assert {"218", "10H", "5K/M"} <= toks


def test_script_check():
    assert script_ok("సికింద్రాబాద్", "Telugu")
    assert not script_ok("Secunderabad", "Telugu")
    assert script_ok("MG Bus Station", "Latin")


def test_sanitize_for_tts_removes_special_characters():
    assert sanitize_for_tts("Say 'more' to hear #1 (rest)!") == "Say more to hear 1 rest"
    assert sanitize_for_tts("बोर्ड पर लिखा है: बस 218।") == "बोर्ड पर लिखा है बस 218।"


def test_chunk_words_respects_limit():
    text = " ".join(f"word{i}." for i in range(70))
    chunks = chunk_words(text, 28)
    assert all(len(c.split()) <= 28 for c in chunks)
    assert " ".join(chunks).split() == text.split()


def test_fuzzy():
    assert fuzzy_eq("Secunderabad", "SECUNDRABAD")
    assert not fuzzy_eq("Koti", "Kondapur")


def test_normalize_name_keeps_vowel_signs():
    from backend.app.services.text_utils import normalize_name
    assert normalize_name("శ్రీ లక్ష్మి, Stores!") == "శ్రీ లక్ష్మి stores"
    assert not fuzzy_eq("కోటి", "కోఠి")  # one different letter in a short name is a different name


def test_text_in_ocr_output():
    from backend.app.services.text_utils import text_in
    assert text_in("Sri Lakshmi", "I - SRI LAKSHMI GENERAL STORES -")
    assert not text_in("Gupta Sweets", "OPEN 7 AM")
    assert not text_in("SB", "SBI ATM")  # too short to trust


def test_speakable_caps():
    from backend.app.services.text_utils import speakable_caps
    assert speakable_caps("NEW SAGAR TIFFIN CENTRE") == "New Sagar Tiffin Centre"
    assert speakable_caps("SBI ATM") == "SBI ATM"
    assert speakable_caps("PLEASE USE GATE NO. 2", sentence=True) == "Please use gate no. 2"
    assert speakable_caps("HDFC BANK") == "HDFC Bank"
    assert speakable_caps("Sri Sai Medicals") == "Sri Sai Medicals"
    assert speakable_caps("సాయి") == "సాయి"
