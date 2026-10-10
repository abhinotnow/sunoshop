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
