"""Known Hyderabad places (data/hyderabad_places.json): the 'is this a real place?' check."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from rapidfuzz import fuzz, process

from ..content import places_raw
from .text_utils import normalize_name


@dataclass(frozen=True)
class Place:
    id: str
    en: str
    te: str
    hi: str
    kind: str

    def name(self, lang: str) -> str:
        return {"en": self.en, "te": self.te, "hi": self.hi}.get(lang) or self.en


class Gazetteer:
    def __init__(self, entries: list[dict]):
        self._by_key: dict[str, Place] = {}
        for e in entries:
            p = Place(e["id"], e["en"], e.get("te", ""), e.get("hi", ""), e.get("kind", ""))
            for name in [e["en"], e.get("te", ""), e.get("hi", ""), *e.get("aliases", [])]:
                key = normalize_name(name)
                if key:
                    self._by_key.setdefault(key, p)
        self._keys = list(self._by_key)

    def match(self, *names: str, threshold: int = 90) -> Place | None:
        """Best match for any of the given spellings (romanized or original script)."""
        best: tuple[int, Place] | None = None
        for raw in names:
            key = normalize_name(raw or "")
            if not key:
                continue
            if key in self._by_key:
                return self._by_key[key]
            hit = process.extractOne(key, self._keys, scorer=fuzz.ratio, score_cutoff=threshold)
            if hit and (best is None or hit[1] > best[0]):
                best = (int(hit[1]), self._by_key[hit[0]])
        return best[1] if best else None

    def __len__(self) -> int:
        return len({p.id for p in self._by_key.values()})


@lru_cache(maxsize=1)
def gazetteer() -> Gazetteer:
    return Gazetteer(places_raw()["places"])
