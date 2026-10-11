// Unit tests for IndexedDB catalog caching and version invalidation
// Exports test suite for offline.ts
// Depends on vitest, fake-indexeddb, ./offline, ./types

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadCatalog,
  clearCatalogCache,
  getCatalogVersion,
  getCachedCatalog,
  saveCatalog,
  getIsOffline,
  setIsOffline,
  subscribeOffline,
  reportServerErrorOffline,
  reportServerOnline,
  withTimeout,
  resetOfflineSignal,
  queryOfflineCatalog,
} from './offline';
import { ProductKnowledgeObject } from './types';

const mockProduct1: ProductKnowledgeObject = {
  id: 'prod_101',
  title: 'CloudWalk Running Shoes',
  brand: 'CloudWalk',
  category: 'Footwear',
  price_inr: 2999,
  specs: { sole: 'EVA Foam', weight: '240g' },
  alt_texts: {
    en: 'Lightweight grey mesh running shoes with white soles',
    hi: 'हल्के भूरे रंग के जालीदार रनिंग जूते',
    te: 'తేలికపాటి గ్రే మెష్ రన్నింగ్ షూస్',
  },
  size_chart: [{ UK: '8', EU: '42', CM: '26.5' }],
  review_digest: {
    pros: ['Very comfortable', 'Lightweight'],
    cons: ['Runs slightly narrow'],
    claims_checked: ['Breathable mesh verified by 84% of reviews'],
  },
  review_chunks: ['Best daily walking shoe I bought this year.'],
};

const mockProduct2: ProductKnowledgeObject = {
  id: 'prod_102',
  title: 'TrailGrip Trekking Boot',
  brand: 'TrailGrip',
  category: 'Footwear',
  price_inr: 4499,
  specs: { sole: 'Vibram Rubber', weight: '480g' },
  alt_texts: {
    en: 'Sturdy brown leather hiking boot with metal eyelets',
    hi: 'मजबूत भूरे चमड़े के ट्रेकिंग बूट्स',
    te: 'ధృడమైన బ్రౌన్ లెదర్ హైకింగ్ బూట్లు',
  },
  size_chart: [{ UK: '8', EU: '42', CM: '27.0' }],
  review_digest: {
    pros: ['Excellent ankle support', 'Water resistant'],
    cons: ['Requires break-in'],
    claims_checked: ['Waterproofing confirmed in wet trail tests'],
  },
  review_chunks: ['Rock solid grip on wet mud and gravel.'],
};

describe('M2-08 IndexedDB Catalog Caching Tests', () => {
  beforeEach(async () => {
    await clearCatalogCache();
  });

  it('second load makes no fetch to /catalog when version is unchanged', async () => {
    let catalogFetchCount = 0;
    let versionFetchCount = 0;

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/catalog/version')) {
        versionFetchCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ version: '2026.v1' }),
        });
      }
      if (url.endsWith('/catalog')) {
        catalogFetchCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockProduct1, mockProduct2],
        });
      }
      return Promise.reject(new Error('Unknown URL: ' + url));
    });

    // 1. First Load (Cold Cache)
    const firstResult = await loadCatalog({
      baseUrl: 'http://localhost:8000',
      fetcher: mockFetch as any,
    });

    expect(firstResult.fetchedFromNetwork).toBe(true);
    expect(firstResult.version).toBe('2026.v1');
    expect(firstResult.products.length).toBe(2);
    expect(firstResult.products[0].id).toBe('prod_101');
    expect(versionFetchCount).toBe(1);
    expect(catalogFetchCount).toBe(1);

    // Verify stored in IndexedDB
    const cachedVer = await getCatalogVersion();
    const cachedProds = await getCachedCatalog();
    expect(cachedVer).toBe('2026.v1');
    expect(cachedProds.length).toBe(2);

    // 2. Second Load (Warm Cache with same version)
    const secondResult = await loadCatalog({
      baseUrl: 'http://localhost:8000',
      fetcher: mockFetch as any,
    });

    expect(secondResult.fetchedFromNetwork).toBe(false);
    expect(secondResult.version).toBe('2026.v1');
    expect(secondResult.products.length).toBe(2);
    expect(secondResult.products[0].id).toBe('prod_101');

    // CRITICAL: version was checked, but /catalog was NOT fetched again!
    expect(versionFetchCount).toBe(2);
    expect(catalogFetchCount).toBe(1); // STILL 1! No fetch to /catalog!
  });

  it('refetches /catalog when version changes', async () => {
    let currentVersion = '2026.v1';
    let catalogFetchCount = 0;

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/catalog/version')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ version: currentVersion }),
        });
      }
      if (url.endsWith('/catalog')) {
        catalogFetchCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [mockProduct1],
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    // First load with v1
    await loadCatalog({ baseUrl: 'http://localhost:8000', fetcher: mockFetch as any });
    expect(catalogFetchCount).toBe(1);

    // Version update on server to v2
    currentVersion = '2026.v2';

    // Second load detects new version and re-fetches /catalog
    const updatedResult = await loadCatalog({
      baseUrl: 'http://localhost:8000',
      fetcher: mockFetch as any,
    });

    expect(updatedResult.fetchedFromNetwork).toBe(true);
    expect(updatedResult.version).toBe('2026.v2');
    expect(catalogFetchCount).toBe(2);
  });

  it('falls back to cached catalog if network fails while offline', async () => {
    const onlineFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/catalog/version')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ version: '2026.v1' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [mockProduct1],
      });
    });

    // Seed cache online
    await loadCatalog({ baseUrl: 'http://localhost:8000', fetcher: onlineFetch as any });

    // Now simulate offline network drop
    const offlineFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const offlineResult = await loadCatalog({
      baseUrl: 'http://localhost:8000',
      fetcher: offlineFetch as any,
    });

    expect(offlineResult.offline).toBe(true);
    expect(offlineResult.fetchedFromNetwork).toBe(false);
    expect(offlineResult.products.length).toBe(1);
    expect(offlineResult.products[0].id).toBe('prod_101');
  });
});

describe('M2-19 Offline Signal Tests', () => {
  beforeEach(() => {
    resetOfflineSignal();
  });

  it('flips offline signal via setIsOffline and notifies subscribers', () => {
    const states: boolean[] = [];
    const unsubscribe = subscribeOffline((isOffline) => {
      states.push(isOffline);
    });

    expect(getIsOffline()).toBe(false);
    setIsOffline(true);
    expect(getIsOffline()).toBe(true);
    expect(states).toEqual([true]);

    setIsOffline(false);
    expect(getIsOffline()).toBe(false);
    expect(states).toEqual([true, false]);

    unsubscribe();
  });

  it('reportServerErrorOffline and reportServerOnline flip offline signal', () => {
    expect(getIsOffline()).toBe(false);
    reportServerErrorOffline();
    expect(getIsOffline()).toBe(true);

    reportServerOnline();
    expect(getIsOffline()).toBe(false);
  });

  it('withTimeout flips offline signal to true when request exceeds timeout threshold', async () => {
    expect(getIsOffline()).toBe(false);

    const slowPromise = new Promise((resolve) => setTimeout(resolve, 500));

    await expect(withTimeout(slowPromise, 100, 'Gateway Timeout')).rejects.toThrow(
      'Gateway Timeout (100ms)'
    );

    // Timeout trigger flipped offline signal
    expect(getIsOffline()).toBe(true);
  });

  it('withTimeout resolves successfully when promise completes before timeout', async () => {
    expect(getIsOffline()).toBe(false);

    const fastPromise = Promise.resolve('data_ok');
    const result = await withTimeout(fastPromise, 500);

    expect(result).toBe('data_ok');
    expect(getIsOffline()).toBe(false);
  });
});

describe('M2-20 Offline Answers Router Tests', () => {
  const mockRedmiPhone: ProductKnowledgeObject = {
    id: 'prod_redmi_13',
    title: 'Redmi Note 13 5G',
    brand: 'Redmi',
    category: 'Electronics',
    price_inr: 15499,
    specs: {
      battery: '5000mAh with 33W fast charge',
      camera: '108MP triple camera system',
      screen: '6.67 inch 120Hz AMOLED',
      ram: '8GB',
      storage: '256GB',
    },
    alt_texts: {
      en: 'Prism blue smartphone with slim bezel and triple rear camera',
      hi: 'प्रिज्म ब्लू स्मार्टफोन',
      te: 'ప్రిజమ్ బ్లూ స్మార్ట్‌ఫోన్',
    },
    size_chart: [],
    review_digest: {
      pros: ['Great battery backup', 'Bright AMOLED display'],
      cons: ['No stereo speakers'],
      claims_checked: ['1.5 days battery life verified'],
    },
    review_chunks: ['The 5000mAh battery lasts nearly two days on normal usage.'],
  };

  beforeEach(async () => {
    await clearCatalogCache();
    await saveCatalog('2026.v1', [mockProduct1, mockProduct2, mockRedmiPhone]);
  });

  it('returns stored battery spec for "battery of Redmi" when network is off', async () => {
    const result = await queryOfflineCatalog('battery of Redmi', 'en');

    expect(result.matched).toBe(true);
    expect(result.title).toBe('Redmi Note 13 5G');
    expect(result.attribute).toBe('battery');
    expect(result.value).toContain('5000mAh');
    expect(result.answerText).toBe(
      'The Redmi Note 13 5G has a battery of 5000mAh with 33W fast charge.'
    );
    expect(result.templated).toBe(true);
  });

  it('returns price spec for "price of CloudWalk" in English and Hindi', async () => {
    const enResult = await queryOfflineCatalog('price of CloudWalk', 'en');
    expect(enResult.matched).toBe(true);
    expect(enResult.attribute).toBe('price');
    expect(enResult.value).toBe('₹2999');
    expect(enResult.answerText).toBe('The price of CloudWalk Running Shoes is ₹2999.');

    const hiResult = await queryOfflineCatalog('CloudWalk ki kimat', 'hi');
    expect(hiResult.matched).toBe(true);
    expect(hiResult.answerText).toBe('CloudWalk Running Shoes की कीमत ₹2999 है।');
  });

  it('returns sole spec for "sole of CloudWalk"', async () => {
    const result = await queryOfflineCatalog('what is the sole of CloudWalk?', 'en');
    expect(result.matched).toBe(true);
    expect(result.attribute).toBe('sole');
    expect(result.value).toBe('EVA Foam');
    expect(result.answerText).toBe('The CloudWalk Running Shoes has a sole of EVA Foam.');
  });

  it('returns verified pros when asked about best features', async () => {
    const result = await queryOfflineCatalog('what are the pros of TrailGrip?', 'en');
    expect(result.matched).toBe(true);
    expect(result.attribute).toBe('pros');
    expect(result.value).toBe('Excellent ankle support');
    expect(result.answerText).toBe(
      'Top verified advantage of TrailGrip Trekking Boot: Excellent ankle support.'
    );
  });

  it('provides graceful fallback when catalog is empty', async () => {
    await clearCatalogCache();
    const result = await queryOfflineCatalog('battery of Redmi', 'en');
    expect(result.matched).toBe(false);
    expect(result.answerText).toContain('No product catalog is stored offline yet');
  });
});

