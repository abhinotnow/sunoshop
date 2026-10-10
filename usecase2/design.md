# SunoShop Design System & Accessibility Architecture

> **SunoShop**: Voice-First, Blind-Accessible eCommerce Proxy for English, Hindi, and Telugu.
> Built for Megathon 2026 | Team PPAP (Team ID: 320)

---

## 1. Design Philosophy: Brutalist Accessibility

Traditional eCommerce websites are overloaded with carousel banners, low-contrast text, ambiguous icons, nested popups, and dragging sliders. For blind screen-reader users, low-vision shoppers, and individuals with motor impairments, these designs create immense cognitive and physical friction.

**SunoShop adopts an unapologetic Brutalist Design System:**
- **Raw Physicality & Heavy Geometry**: Sharp borders (`2px - 3px solid`), zero rounded gimmicks, crisp tactile shadows (`shadow-brutal`). Every element feels clickable, heavy, and distinct.
- **Maximum Perceptual Contrast**: Strict adherence to WCAG AAA contrast standards ($> 7:1$ for UI controls, $> 20:1$ for captions and primary text).
- **Zero Ambiguity**: No hidden hover states, no gesture-only controls, no draggable sliders (WCAG 2.5.7). Everything is single-tap or voice-driven.
- **Auditory-First Architecture**: Sound and spatial position are first-class visual and tactile companions, not afterthoughts.

---

## 2. Color Palette & Visual Tokens

The user-facing palette is built on **Coral Red**, **Deep Void Black**, and **Architectural Greys**:

| Token Name | Hex Code | Purpose / Usage | WCAG Contrast |
|---|---|---|---|
| **Coral Red Primary** | `#ff4d4d` | Active actions, logo, focus indicators, spatial pills | $> 7.5:1$ on `#09090b` |
| **Coral Red Hover** | `#ff6666` | Hover highlight on buttons and interactive cards | $> 8.2:1$ on `#09090b` |
| **Coral Red Muted** | `#7f1d1d` | Subtle borders, warning tints, active backdrops | N/A |
| **Void Black** | `#09090b` | Primary background, OLED power efficiency, zero glare | Core Base |
| **Concrete Surface** | `#18181b` | Cards, shelf product containers, control decks | Base Deck |
| **Elevated Card** | `#27272a` | Secondary buttons, metadata badges | Base Elevated |
| **Concrete Border** | `#3f3f46` | Sharp structural borders, grid dividers | Visible Grid |
| **Muted Grey Text** | `#a1a1aa` | Secondary labels, timestamps, metadata | $> 5.8:1$ on `#09090b` |
| **Brutal White** | `#fafafa` | Primary headings, product titles, live captions | $> 21:1$ on `#09090b` (AAA) |

### Focus Ring Standard
All focusable elements use a high-visibility, 3px solid Coral Red outline with an offset:
```css
outline: 3px solid #ff4d4d;
outline-offset: 3px;
```

---

## 3. Typography & Information Hierarchy

- **Monospace Display (`JetBrains Mono`, `Space Mono`, `ui-monospace`)**:
  - Used for prices, status badges, spatial audio coordinates, and action buttons.
  - Numbers are tabular and fixed-width, preventing visual jitter during price and quantity adjustments.
- **Geometric Sans (`Inter`, `system-ui`)**:
  - Used for product descriptions and accessible image alt-text to maximize body readability.

### Heading Structure
- `<h1>`: Top application header landmark ("SunoShop – Voice-First Accessible Shopping").
- `<h2>`: Primary landmark regions (`Curated Product Shelf`, `Voice Assistant Controls`, `Order Review`).
- `<h3>`: Discrete product titles and panel subsections.

---

## 4. Audio & Haptic Architecture

### 4.1 Binaural Spatial Audio Shelf (M2-11)
Top-3 shelf recommendations are mapped across the stereo soundstage:
- **Product 1 (Top Match)**: Panned hard **Left** (`pan: -1.0`)
- **Product 2 (Runner-Up)**: Panned **Center** (`pan: 0.0`)
- **Product 3 (Alternative)**: Panned hard **Right** (`pan: +1.0`)
- **Fallback**: Graceful sequential mono chime when `StereoPannerNode` is unavailable.

### 4.2 Tactile Vibration Signals (M2-07)
When `navigator.vibrate` is supported, tactile feedback accompanies audio cues:
- **Listening State**: Single short pulse (`40ms`).
- **Success / Match**: Crisp triple burst (`[50ms, 60ms, 50ms]`).
- **Error / Silence Timeout**: Warning burst pattern (`[150ms, 80ms, 150ms, 80ms, 200ms]`).

---

## 5. Non-Draggable Voice Price Filter (WCAG 2.5.7)

Traditional eCommerce range sliders require fine motor precision and dragging gestures that fail accessibility standards.

SunoShop eliminates sliders entirely:
1. **Multilingual Voice Queries**:
   - **English**: *"under fifteen thousand"*, *"under ₹3,000"*, *"below 2.5k"*, *"less than 5000"*.
   - **Hindi**: *"तीन हज़ार से कम"*, *"5000 ke andar"*, *"पंद्रह हज़ार"*.
   - **Telugu**: *"మూడు వేల లోపు"*, *"3000 lopala"*, *"ఐదు వేల లోపు"*.
2. **Discrete Stepper Buttons**:
   - Large `[- ₹500]` and `[+ ₹500]` buttons ($\ge 56\text{px}$ touch targets).
   - Instant auditory announcement of matching products via `announce()`.
   - Single-tap `Clear Cap` button to restore full recommendations.

---

## 6. Adaptive UI & Friction Tracker (M2-13 & M2-14)

Accessibility needs vary dynamically. A shopper walking outside or someone experiencing tremors may struggle with standard buttons.

```
+-------------------------------------------------------------+
|                     User Interaction                        |
|   (Taps, Speech Utterances, Repeat Clarification Requests)   |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|            FrictionTracker (Sliding Window: 60s)            |
|   - tap_miss >= 3      --> Suggest larger_targets (>=72px)  |
|   - asr_timeout >= 2   --> Suggest slower_speech / pause    |
|   - explain_again >= 2 --> Suggest explain_simpler          |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|             Architectural Invariant: Zero Mutation          |
|    System NEVER alters the UI automatically/unprompted      |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|              Adaptation Prompt (Modal Banner)               |
|   - Speaks proposal aloud via live region                   |
|   - Visual high-contrast banner with Coral Red highlight     |
|   - [Accept Change]  vs  [Dismiss / Keep Default]           |
|   - 100% Reversible at any time                             |
+-------------------------------------------------------------+
```

### 6.1 Adaptations Available
1. **`larger_targets`**: Enlarge touch targets from $56\text{px}$ to $\ge 72\text{px}$ across buttons and navigation items.
2. **`slower_speech`**: Reduce TTS playback rate by 20% ($0.8\times$) and increase inter-sentence pauses.
3. **`explain_simpler`**: Strip technical jargon and present plain-language summaries.

---

## 7. Touch Target Sizing Matrix

| Component | Default Touch Target | Adapted (Large Target Mode) | WCAG Standard |
|---|---|---|---|
| Primary Voice Mic Button | $64\text{px} \times 64\text{px}$ | $84\text{px} \times 84\text{px}$ | Exceeds WCAG 2.5.5 ($44\text{px}$) |
| Stepper Buttons ($\pm ₹500$) | $56\text{px} \times 56\text{px}$ | $72\text{px} \times 72\text{px}$ | Exceeds WCAG 2.5.8 ($24\text{px}$) |
| Shelf Action Buttons | $48\text{px} \times 100\%$ | $72\text{px} \times 100\%$ | Exceeds WCAG 2.5.5 |
| Language Switcher | $48\text{px} \times 48\text{px}$ | $64\text{px} \times 64\text{px}$ | Exceeds WCAG 2.5.5 |

---

## 8. Screen Reader & Live Region Announcer

SunoShop uses an isolated, non-duplicating ARIA live region (`#aria-live-announcer`) managed via `announce(message, priority)`:
- **`polite`**: Used for search results, price adjustments, and language switches.
- **`assertive`**: Used for dark-pattern fee stripping alerts, verbal checkout challenges, and adaptation consent prompts.
- Announcements feature a 50ms mutation delay to ensure screen readers reliably trigger without being clobbered by DOM repaints.
