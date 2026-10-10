// IndexedDB caching for product catalog with version checking and offline support
// Exports loadCatalog, getCachedCatalog, getCatalogVersion, saveCatalog, clearCatalogCache, openCatalogDB
// Depends on browser IndexedDB API, types.ts

import { ProductKnowledgeObject } from './types';

const DB_NAME = 'sunoshop_db';
const DB_VERSION = 1;
const STORE_META = 'catalog_meta';
const STORE_PRODUCTS = 'products';

function getIDBFactory(): IDBFactory | null {
  if (typeof indexedDB !== 'undefined') {
    return indexedDB;
  }
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  return null;
}

export function openCatalogDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = getIDBFactory();
    if (!idb) {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }

    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCatalogVersion(): Promise<string | null> {
  try {
    const db = await openCatalogDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const req = store.get('version');
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to get catalog version from IndexedDB:', err);
    return null;
  }
}

export async function getCachedCatalog(): Promise<ProductKnowledgeObject[]> {
  try {
    const db = await openCatalogDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const store = tx.objectStore(STORE_PRODUCTS);
      const req = store.getAll();
      req.onsuccess = () => {
        resolve(req.result || []);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to get cached products from IndexedDB:', err);
    return [];
  }
}

export async function saveCatalog(
  version: string,
  products: ProductKnowledgeObject[]
): Promise<void> {
  const db = await openCatalogDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_PRODUCTS], 'readwrite');
    const metaStore = tx.objectStore(STORE_META);
    const prodStore = tx.objectStore(STORE_PRODUCTS);

    metaStore.put({ key: 'version', value: version });

    // Clear existing products and store the updated ones
    prodStore.clear();
    for (const prod of products) {
      prodStore.put(prod);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearCatalogCache(): Promise<void> {
  const db = await openCatalogDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_PRODUCTS], 'readwrite');
    tx.objectStore(STORE_META).clear();
    tx.objectStore(STORE_PRODUCTS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface LoadCatalogResult {
  version: string;
  products: ProductKnowledgeObject[];
  fetchedFromNetwork: boolean;
  offline: boolean;
}

export interface LoadCatalogOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export async function loadCatalog(
  options: LoadCatalogOptions = {}
): Promise<LoadCatalogResult> {
  const fetchFn = options.fetcher || (typeof fetch !== 'undefined' ? fetch.bind(window) : undefined);
  const baseUrl = options.baseUrl || 'http://localhost:8000';

  const cachedVersion = await getCatalogVersion();
  const cachedProducts = await getCachedCatalog();

  if (!fetchFn) {
    return {
      version: cachedVersion || 'offline',
      products: cachedProducts,
      fetchedFromNetwork: false,
      offline: true,
    };
  }

  try {
    // Step 1: Check server version
    const versionRes = await fetchFn(`${baseUrl}/catalog/version`);
    if (!versionRes.ok) {
      throw new Error(`Catalog version fetch failed: ${versionRes.status}`);
    }
    const versionData = await versionRes.json();
    const serverVersion: string = typeof versionData === 'string' ? versionData : versionData.version;

    // Step 2: Compare with cached version
    if (cachedVersion && cachedVersion === serverVersion && cachedProducts.length > 0) {
      // Version unchanged and products cached: skip fetching /catalog
      return {
        version: cachedVersion,
        products: cachedProducts,
        fetchedFromNetwork: false,
        offline: false,
      };
    }

    // Step 3: Fetch new catalog
    const catalogRes = await fetchFn(`${baseUrl}/catalog`);
    if (!catalogRes.ok) {
      throw new Error(`Catalog fetch failed: ${catalogRes.status}`);
    }
    const catalogData = await catalogRes.json();
    const products: ProductKnowledgeObject[] = Array.isArray(catalogData)
      ? catalogData
      : catalogData.products || [];

    // Step 4: Persist in IndexedDB
    await saveCatalog(serverVersion, products);

    return {
      version: serverVersion,
      products,
      fetchedFromNetwork: true,
      offline: false,
    };
  } catch (err) {
    console.warn('Network error during catalog check, falling back to cache:', err);
    if (cachedProducts.length > 0) {
      return {
        version: cachedVersion || 'cached',
        products: cachedProducts,
        fetchedFromNetwork: false,
        offline: true,
      };
    }
    throw err;
  }
}

// ============================================================================
// M2-19 Offline Signal
// Combines navigator.onLine, server error{offline}, and 2.5s network timeout
// ============================================================================

type OfflineListener = (isOffline: boolean) => void;

class OfflineSignalManager {
  private offlineState: boolean = false;
  private listeners: Set<OfflineListener> = new Set();
  private hasInitializedDOMListeners: boolean = false;

  constructor() {
    this.checkInitialNavigator();
  }

  private checkInitialNavigator(): void {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      this.offlineState = !navigator.onLine;
    }
  }

  public get isOffline(): boolean {
    return this.offlineState;
  }

  public setOffline(offline: boolean): void {
    if (this.offlineState !== offline) {
      this.offlineState = offline;
      this.notifyListeners();
    }
  }

  public subscribe(listener: OfflineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.offlineState);
      } catch (err) {
        console.error('Error in offline subscriber callback:', err);
      }
    }
  }

  public initDOMListeners(): () => void {
    if (this.hasInitializedDOMListeners || typeof window === 'undefined') {
      return () => {};
    }
    this.hasInitializedDOMListeners = true;

    const handleOnline = () => this.setOffline(false);
    const handleOffline = () => this.setOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      this.hasInitializedDOMListeners = false;
    };
  }

  public reset(): void {
    this.listeners.clear();
    this.offlineState = false;
    this.checkInitialNavigator();
  }
}

const offlineManager = new OfflineSignalManager();

export function getIsOffline(): boolean {
  return offlineManager.isOffline;
}

export function setIsOffline(offline: boolean): void {
  offlineManager.setOffline(offline);
}

export function subscribeOffline(listener: (isOffline: boolean) => void): () => void {
  return offlineManager.subscribe(listener);
}

export function reportServerErrorOffline(): void {
  offlineManager.setOffline(true);
}

export function reportServerOnline(): void {
  offlineManager.setOffline(false);
}

export function initOfflineSignalListeners(): () => void {
  return offlineManager.initDOMListeners();
}

export function resetOfflineSignal(): void {
  offlineManager.reset();
}

// 2.5s network timeout wrapper as specified in M2-19
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 2500,
  errorMessage: string = 'Network request timed out'
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      offlineManager.setOffline(true);
      reject(new Error(`${errorMessage} (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ============================================================================
// M2-20 Offline Answers Router
// Local keyword router + spec lookup over IndexedDB cache; templated answers
// Example: "battery of Redmi" -> "The Redmi Note 13 has a battery of 5000mAh."
// ============================================================================

export interface OfflineAnswerResult {
  matched: boolean;
  productId?: string;
  title?: string;
  attribute?: string;
  value?: string;
  answerText: string;
  templated: boolean;
}

const SPEC_SYNONYMS: Record<string, string[]> = {
  battery: ['battery', 'mah', 'power', 'charging'],
  sole: ['sole', 'outsole', 'insole', 'cushion', 'grip'],
  weight: ['weight', 'heavy', 'light', 'grams', 'g'],
  screen: ['screen', 'display', 'inch', 'refresh rate', 'hz'],
  camera: ['camera', 'mp', 'lens', 'photo'],
  ram: ['ram', 'memory'],
  storage: ['storage', 'rom', 'gb', 'capacity'],
  price: ['price', 'cost', 'rate', 'rupees', 'rs', 'inr', 'kimat', 'dhara'],
  pros: ['pro', 'pros', 'advantage', 'best', 'feature', 'good'],
  cons: ['con', 'cons', 'drawback', 'downside', 'bad'],
};

export async function queryOfflineCatalog(
  query: string,
  lang: 'en' | 'hi' | 'te' = 'en'
): Promise<OfflineAnswerResult> {
  const cleanQuery = query.toLowerCase().trim();
  const cachedProducts = await getCachedCatalog();

  if (cachedProducts.length === 0) {
    const emptyMsg = {
      en: 'No product catalog is stored offline yet. Please connect to the internet to sync catalog data.',
      hi: 'ऑफ़लाइन कोई उत्पाद संग्रहीत नहीं है। कृपया कैटलॉग सिंक करने के लिए इंटरनेट से कनेक्ट करें।',
      te: 'ఆఫ్‌లైన్‌లో ఉత్పత్తులు ఏవీ నిల్వ చేయబడలేదు. దయచేసి డేటాను సింక్ చేయడానికి ఇంటర్నెట్‌కి కనెక్ట్ అవ్వండి.',
    }[lang];

    return {
      matched: false,
      answerText: emptyMsg,
      templated: true,
    };
  }

  // 1. Identify matched product by title, brand, or id
  let matchedProduct: ProductKnowledgeObject | null = null;
  for (const prod of cachedProducts) {
    const titleLower = prod.title.toLowerCase();
    const brandLower = (prod.brand || '').toLowerCase();
    const idLower = prod.id.toLowerCase();

    // Check direct word containment (e.g. "redmi", "cloudwalk", "trailgrip")
    const words = `${titleLower} ${brandLower} ${idLower}`.split(/\s+/);
    for (const w of words) {
      if (w.length > 2 && cleanQuery.includes(w)) {
        matchedProduct = prod;
        break;
      }
    }
    if (matchedProduct) break;
  }

  // If no specific brand/title mentioned, default to the first cached product
  if (!matchedProduct && cachedProducts.length > 0) {
    // Check if query is generic about "shoe", "phone", "specs"
    matchedProduct = cachedProducts[0];
  }

  if (!matchedProduct) {
    const notFoundMsg = {
      en: 'I am in offline mode with access only to cached specs. Please ask about a saved product.',
      hi: 'मैं ऑफ़लाइन मोड में हूँ। कृपया सहेजे गए उत्पाद के बारे में पूछें।',
      te: 'నేను ఆఫ్‌లైన్ మోడ్‌లో ఉన్నాను. దయచేసి నిల్వ చేసిన ఉత్పత్తి గురించి అడగండి.',
    }[lang];

    return {
      matched: false,
      answerText: notFoundMsg,
      templated: true,
    };
  }

  // 2. Identify requested attribute / spec
  // Strip product title and brand tokens so brand names don't trigger false spec matches (e.g. "TrailGrip" shouldn't trigger "grip")
  let queryBody = cleanQuery;
  const productTokens = `${matchedProduct.title} ${matchedProduct.brand || ''}`.toLowerCase().split(/\s+/);
  for (const token of productTokens) {
    if (token.length > 2) {
      queryBody = queryBody.split(token).join(' ');
    }
  }

  let matchedSpecKey: string | null = null;
  for (const [canonicalSpec, synonyms] of Object.entries(SPEC_SYNONYMS)) {
    if (synonyms.some((syn) => {
      const regex = new RegExp(`\\b${syn}\\b`, 'i');
      return regex.test(queryBody) || queryBody.includes(syn);
    })) {
      matchedSpecKey = canonicalSpec;
      break;
    }
  }

  // Check specs dictionary for exact or fuzzy keys
  let specValue: string | undefined;
  if (matchedSpecKey && matchedSpecKey !== 'price' && matchedSpecKey !== 'pros' && matchedSpecKey !== 'cons') {
    if (matchedProduct.specs) {
      for (const [key, val] of Object.entries(matchedProduct.specs)) {
        if (key.toLowerCase().includes(matchedSpecKey) || matchedSpecKey.includes(key.toLowerCase())) {
          specValue = String(val);
          matchedSpecKey = key;
          break;
        }
      }
    }
  }

  // 3. Format templated answers
  if (matchedSpecKey === 'price') {
    const priceText = {
      en: `The price of ${matchedProduct.title} is ₹${matchedProduct.price_inr}.`,
      hi: `${matchedProduct.title} की कीमत ₹${matchedProduct.price_inr} है।`,
      te: `${matchedProduct.title} ధర ₹${matchedProduct.price_inr}.`,
    }[lang];

    return {
      matched: true,
      productId: matchedProduct.id,
      title: matchedProduct.title,
      attribute: 'price',
      value: `₹${matchedProduct.price_inr}`,
      answerText: priceText,
      templated: true,
    };
  }

  if (matchedSpecKey === 'pros' && matchedProduct.review_digest?.pros?.length) {
    const pro = matchedProduct.review_digest.pros[0];
    const prosText = {
      en: `Top verified advantage of ${matchedProduct.title}: ${pro}.`,
      hi: `${matchedProduct.title} का मुख्य लाभ: ${pro}।`,
      te: `${matchedProduct.title} ప్రధాన ప్రయోజనం: ${pro}.`,
    }[lang];

    return {
      matched: true,
      productId: matchedProduct.id,
      title: matchedProduct.title,
      attribute: 'pros',
      value: pro,
      answerText: prosText,
      templated: true,
    };
  }

  if (matchedSpecKey && specValue) {
    const answer = {
      en: `The ${matchedProduct.title} has a ${matchedSpecKey} of ${specValue}.`,
      hi: `${matchedProduct.title} की ${matchedSpecKey} ${specValue} है।`,
      te: `${matchedProduct.title} యొక్క ${matchedSpecKey} ${specValue}.`,
    }[lang];

    return {
      matched: true,
      productId: matchedProduct.id,
      title: matchedProduct.title,
      attribute: matchedSpecKey,
      value: specValue,
      answerText: answer,
      templated: true,
    };
  }

  // Default overview fallback if no specific spec matched
  const defaultOverview = {
    en: `${matchedProduct.title} is priced at ₹${matchedProduct.price_inr}. Specs: ${Object.entries(matchedProduct.specs || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'Standard specifications'}.`,
    hi: `${matchedProduct.title} की कीमत ₹${matchedProduct.price_inr} है। विवरण: ${Object.entries(matchedProduct.specs || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'सामान्य विवरण'}।`,
    te: `${matchedProduct.title} ధర ₹${matchedProduct.price_inr}. వివరాలు: ${Object.entries(matchedProduct.specs || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'సాధారణ వివరాలు'}.`,
  }[lang];

  return {
    matched: true,
    productId: matchedProduct.id,
    title: matchedProduct.title,
    answerText: defaultOverview,
    templated: true,
  };
}
