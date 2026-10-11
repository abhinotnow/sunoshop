// Multilingual dictionary and language helper for English, Hindi, and Telugu
// Exports Language type, languages list, and getTranslation helper
// Depends on nothing
export type Language = 'en' | 'hi' | 'te';

export interface Translations {
  appName: string;
  tagline: string;
  skipLink: string;
  navLabel: string;
  readyButton: string;
  languageSelectLabel: string;
  liveRegionDefault: string;
  switchedLanguage: string;
}

export const translations: Record<Language, Translations> = {
  en: {
    appName: 'SunoShop',
    tagline: 'Voice-First Accessible eCommerce Proxy',
    skipLink: 'Skip to main content',
    navLabel: 'Main Navigation',
    readyButton: 'Ready',
    languageSelectLabel: 'Select Language',
    liveRegionDefault: 'Welcome to SunoShop. System ready.',
    switchedLanguage: 'Language switched to English',
  },
  hi: {
    appName: 'सुनोशॉप',
    tagline: 'वॉयस-फर्स्ट सुलभ ई-कॉमर्स प्रॉक्सी',
    skipLink: 'मुख्य सामग्री पर जाएं',
    navLabel: 'मुख्य नेविगेशन',
    readyButton: 'तैयार',
    languageSelectLabel: 'भाषा चुनें',
    liveRegionDefault: 'सुनोशॉप में आपका स्वागत है। सिस्टम तैयार है।',
    switchedLanguage: 'भाषा हिंदी में बदली गई',
  },
  te: {
    appName: 'సునోషాప్',
    tagline: 'వాయిస్-ఫస్ట్ యాక్సెసిబుల్ ఈ-కామర్స్ ప్రాక్సీ',
    skipLink: 'ప్రధాన విషయానికి వెళ్లండి',
    navLabel: 'ప్రధాన నావిగేషన్',
    readyButton: 'సిద్ధం',
    languageSelectLabel: 'భాషను ఎంచుకోండి',
    liveRegionDefault: 'సునోషాప్‌కు స్వాగతం. సిస్టమ్ సిద్ధంగా ఉంది.',
    switchedLanguage: 'భాష తెలుగులోకి మార్చబడింది',
  },
};

export const availableLanguages: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
];

export function getTranslation(lang: Language): Translations {
  return translations[lang] || translations.en;
}
