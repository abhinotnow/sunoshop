# Defines SunoShop's product knowledge object and WebSocket message schemas.
# Exports Pydantic models and client/server message unions used across the API.
# Depends on Pydantic; field names follow McAuley Amazon Reviews 2023 and CONTRACT.md.

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


Language = Literal["en", "hi", "te"]
ReviewLanguage = Literal["en", "hi", "te", "hi-en"]


class AltText(BaseModel):
    en: str
    hi: str
    te: str


class ProductImage(BaseModel):
    thumb: str | None = None
    large: str | None = None
    variant: str | None = None
    hi_res: str | None = None
    alt_text: AltText | None = None


class ProductReview(BaseModel):
    rating: float = Field(ge=0, le=5)
    title: str | None = None
    text: str = Field(min_length=1)
    timestamp: int | None = None
    verified_purchase: bool | None = None
    helpful_vote: int | None = None
    user_id: str | None = None
    parent_asin: str = Field(min_length=1)
    synthetic: bool
    lang: ReviewLanguage


class ReviewDigest(BaseModel):
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)


class ReviewChunk(BaseModel):
    aspect: str
    text: str
    embedding: list[float] = Field(default_factory=list)


class ProductKnowledgeObject(BaseModel):
    """Amazon product fields plus SunoShop's normalized accessibility/review fields."""

    model_config = ConfigDict(extra="forbid")

    parent_asin: str = Field(min_length=1)
    title: str = Field(min_length=1)
    price: float = Field(gt=0)
    features: list[str] = Field(default_factory=list)
    description: list[str] = Field(default_factory=list)
    images: list[ProductImage] = Field(default_factory=list)
    store: str | None = None
    average_rating: float | None = Field(default=None, ge=0, le=5)
    rating_number: int | None = Field(default=None, ge=0)
    categories: list[str] = Field(default_factory=list)
    details: dict[str, object] = Field(default_factory=dict)

    # Additional source fields present in Amazon Reviews 2023 metadata.
    main_category: str | None = None
    videos: list[dict[str, object]] = Field(default_factory=list)
    bought_together: list[str] | None = None

    # SunoShop fields; price_inr is rounded from the source USD price.
    price_inr: int = Field(gt=0)
    image_url: str | None = None
    alt_text: AltText
    review_digest: ReviewDigest
    size_chart: list[dict[str, object]] = Field(default_factory=list)
    reviews: list[ProductReview] = Field(default_factory=list)
    review_chunks: list[ReviewChunk] = Field(default_factory=list)


class SessionStart(BaseModel):
    type: Literal["session.start"]
    lang: Language
    mode: Literal["push_to_talk", "auto"]
    rate: float = Field(gt=0, le=2)


class AudioUtterance(BaseModel):
    type: Literal["audio.utterance"]
    audio_base64: str = Field(min_length=1)
    content_type: Literal["audio/wav"] = "audio/wav"
    sample_rate_hz: Literal[16000] = 16000
    channels: Literal[1] = 1
    duration_ms: int = Field(gt=0, le=20_000)


class UIEvent(BaseModel):
    type: Literal["ui.event"]
    kind: Literal["tap_miss", "asr_timeout", "explain_again"]


class CheckoutAction(BaseModel):
    type: Literal["checkout.action"]
    action: Literal["start", "confirm_audio", "cancel"]
    audio_base64: str | None = None

    @model_validator(mode="after")
    def confirmation_requires_audio(self) -> "CheckoutAction":
        if self.action == "confirm_audio" and not self.audio_base64:
            raise ValueError("confirm_audio requires audio_base64")
        return self


ClientMessage = Annotated[
    Union[SessionStart, AudioUtterance, UIEvent, CheckoutAction],
    Field(discriminator="type"),
]


class ASRResult(BaseModel):
    type: Literal["asr.result"]
    text: str
    plausible: bool


class CheckAgain(BaseModel):
    type: Literal["check_again"]
    reason: str


class ReplySentence(BaseModel):
    type: Literal["reply.sentence"]
    idx: int = Field(ge=0)
    text: str
    audio_base64: str
    content_type: Literal["audio/wav"] = "audio/wav"
    pause_ms: int = Field(ge=0)
    rate: float = Field(gt=0, le=2)


class ReplyDone(BaseModel):
    type: Literal["reply.done"]
    grounded: bool


class ShelfProduct(BaseModel):
    parent_asin: str
    title: str
    price_inr: int = Field(gt=0)
    pan: float = Field(ge=-1, le=1)
    alt_text: str


class ShelfResults(BaseModel):
    type: Literal["shelf.results"]
    products: list[ShelfProduct] = Field(max_length=3)


CheckoutStateName = Literal[
    "BROWSING", "CART_REVIEW", "GUARDED", "AWAITING_CONFIRM", "ORDER_PLACED"
]


class CartItem(BaseModel):
    parent_asin: str
    title: str
    quantity: int = Field(gt=0)
    unit_price_inr: int = Field(gt=0)
    total_price_inr: int = Field(gt=0)


class RemovedFee(BaseModel):
    name: str
    amount_inr: int = Field(gt=0)


class CheckoutState(BaseModel):
    type: Literal["checkout.state"]
    state: CheckoutStateName
    cart: list[CartItem]
    total_inr: int = Field(ge=0)
    removed_fees: list[RemovedFee] = Field(default_factory=list)


class ConfirmChallenge(BaseModel):
    type: Literal["confirm.challenge"]
    phrase: str
    lang: Language
    attempts_remaining: int = Field(ge=0)


class AdaptOffer(BaseModel):
    type: Literal["adapt.offer"]
    adaptation: Literal["larger_targets", "slower_speech"]
    reason: str


class ErrorMessage(BaseModel):
    type: Literal["error"]
    code: str
    fallback: Literal["retry", "offline"]


ServerMessage = Annotated[
    Union[
        ASRResult,
        CheckAgain,
        ReplySentence,
        ReplyDone,
        ShelfResults,
        CheckoutState,
        ConfirmChallenge,
        AdaptOffer,
        ErrorMessage,
    ],
    Field(discriminator="type"),
]
