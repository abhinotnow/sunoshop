// Voice price filter parser converting spoken natural language queries into numeric price caps
// Exports parseVoicePrice, formatPriceINR
// Depends on nothing

// Multi-lingual spoken number dictionaries
const WORD_TO_NUMBER: Record<string, number> = {
  // English
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  lakh: 100000,
  k: 1000,

  // Hindi / Hinglish phonetics
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  paanch: 5,
  che: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  gyarah: 11,
  barah: 12,
  terah: 13,
  chaudah: 14,
  pandrah: 15,
  bees: 20,
  tees: 30,
  chalis: 40,
  pachas: 50,
  sau: 100,
  hazaar: 1000,
  hazar: 1000,
  'हज़ार': 1000,
  'सौ': 100,
  'तीन': 3,
  'पाँच': 5,
  'दस': 10,
  'पंद्रह': 15,

  // Telugu phonetics
  okati: 1,
  rendu: 2,
  moodu: 3,
  naalugu: 4,
  aidu: 5,
  aaru: 6,
  yedu: 7,
  enimidi: 8,
  tommidi: 9,
  padi: 10,
  padihenu: 15,
  iravai: 20,
  vanda: 100,
  velu: 1000,
  vele: 1000,
  'వేలు': 1000,
  'వేల': 1000,
  'మూడు': 3,
  'ఐదు': 5,
  'పది': 10,
  'పదిహేను': 15,
};

/**
 * Formats a numeric price into localized Indian Rupee format (e.g. ₹15,000)
 */
export function formatPriceINR(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

/**
 * Parses natural language voice queries containing price constraints
 * Examples:
 * - "under fifteen thousand" -> 15000
 * - "under 3000" -> 3000
 * - "below ₹2,500" -> 2500
 * - "less than 5000" -> 5000
 * - "under 10k" -> 10000
 * - "3000 se kam" -> 3000
 * - "ఐదు వేల లోపు" -> 5000
 */
export function parseVoicePrice(utterance: string): number | null {
  if (!utterance || typeof utterance !== 'string') return null;

  const text = utterance.toLowerCase().trim();

  // Price constraint trigger keywords in EN, HI, TE
  const triggers = [
    'under',
    'below',
    'less than',
    'within',
    'max',
    'up to',
    'budget',
    'se kam',
    'ke andar',
    'ke neeche',
    'se kamti',
    'lopala',
    'lopu',
    'thakkuva',
    'లోపు',
    'లోపల',
    'से कम',
    'के अंदर',
    'के नीचे',
  ];

  const hasTrigger = triggers.some((trigger) => text.includes(trigger));
  // If no explicit trigger keyword is found, return null
  if (!hasTrigger) {
    return null;
  }

  // 1. Direct Regex match for numbers with 'k', e.g. "under 15k", "under 1.5k"
  const kMatch = text.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch && kMatch[1]) {
    const val = parseFloat(kMatch[1]) * 1000;
    return Math.round(val);
  }

  // 2. Direct Regex match for standard digits (e.g. "under 15000", "below ₹3,500")
  const digitMatch = text.match(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{3})+|\d+)/i);
  if (digitMatch && digitMatch[1]) {
    const cleaned = digitMatch[1].replace(/,/g, '');
    const num = parseInt(cleaned, 10);
    if (!isNaN(num) && num > 0) {
      return num;
    }
  }

  // 3. Spoken compound word parser (e.g. "fifteen thousand", "three thousand five hundred", "pandrah hazaar")
  const words = text
    .replace(/[^\w\s\u0900-\u097F\u0C00-\u0C7F]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let total = 0;
  let current = 0;
  let foundNumber = false;

  for (const word of words) {
    const val = WORD_TO_NUMBER[word];
    if (val !== undefined) {
      foundNumber = true;
      if (val === 100000) {
        // lakh
        current = (current === 0 ? 1 : current) * 100000;
        total += current;
        current = 0;
      } else if (val === 1000) {
        // thousand / hazaar / velu
        current = (current === 0 ? 1 : current) * 1000;
        total += current;
        current = 0;
      } else if (val === 100) {
        // hundred / sau / vanda
        current = (current === 0 ? 1 : current) * 100;
      } else {
        current += val;
      }
    }
  }

  total += current;

  if (foundNumber && total > 0) {
    return total;
  }

  return null;
}
