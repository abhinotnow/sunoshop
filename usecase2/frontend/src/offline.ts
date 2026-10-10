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
