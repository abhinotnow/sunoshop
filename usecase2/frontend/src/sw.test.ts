// Unit tests for PWA manifest installability and Service Worker offline shell fallback
// Exports test suite for sw.ts
// Depends on vitest, ./sw, fs

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CACHE_NAME,
  SHELL_ASSETS,
  precacheShellAssets,
  cleanOldCaches,
  handleFetch,
  registerSW,
} from './sw';
import fs from 'fs';
import path from 'path';

describe('M2-09 PWA Installability & Offline App Shell Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates manifest.webmanifest satisfies PWA installability criteria', () => {
    const manifestPath = path.resolve(__dirname, '../public/manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifestContent.name).toBe('SunoShop - Voice-First Accessible Shopping');
    expect(manifestContent.short_name).toBe('SunoShop');
    expect(manifestContent.start_url).toBe('/');
    expect(manifestContent.display).toBe('standalone');
    expect(manifestContent.theme_color).toBe('#ff4d4d');
    expect(manifestContent.background_color).toBe('#09090b');

    // Must have >= 192px and 512px icons
    expect(Array.isArray(manifestContent.icons)).toBe(true);
    const icon192 = manifestContent.icons.find((i: any) => i.sizes === '192x192');
    const icon512 = manifestContent.icons.find((i: any) => i.sizes === '512x512');
    expect(icon192).toBeDefined();
    expect(icon512).toBeDefined();
  });

  it('verifies SHELL_ASSETS contains essential precached offline resources', () => {
    expect(SHELL_ASSETS).toContain('/');
    expect(SHELL_ASSETS).toContain('/index.html');
    expect(SHELL_ASSETS).toContain('/manifest.webmanifest');
  });

  it('precaches app shell assets into CacheStorage', async () => {
    const addAllMock = vi.fn().mockResolvedValue(undefined);
    const mockCache = { addAll: addAllMock };
    const openMock = vi.fn().mockResolvedValue(mockCache);

    (globalThis as any).caches = {
      open: openMock,
    };

    await precacheShellAssets(CACHE_NAME, SHELL_ASSETS);

    expect(openMock).toHaveBeenCalledWith(CACHE_NAME);
    expect(addAllMock).toHaveBeenCalledWith(SHELL_ASSETS);
  });

  it('cleans up obsolete cache versions on activate', async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    const keysMock = vi.fn().mockResolvedValue(['sunoshop-old-v0', CACHE_NAME]);

    (globalThis as any).caches = {
      keys: keysMock,
      delete: deleteMock,
    };

    await cleanOldCaches(CACHE_NAME);

    expect(deleteMock).toHaveBeenCalledWith('sunoshop-old-v0');
    expect(deleteMock).not.toHaveBeenCalledWith(CACHE_NAME);
  });

  it('loads app shell from cache when offline during navigation', async () => {
    const cachedShellResponse = new Response('<!DOCTYPE html><html><body>SunoShop Shell</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });

    const matchMock = vi.fn().mockImplementation((reqOrUrl) => {
      const url = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
      if (url.includes('/index.html') || url === '/' || (typeof reqOrUrl === 'object' && reqOrUrl.mode === 'navigate')) {
        return Promise.resolve(cachedShellResponse);
      }
      return Promise.resolve(null);
    });

    (globalThis as any).caches = {
      match: matchMock,
      open: vi.fn(),
    };

    // Simulate navigation request while completely offline (fetch fails)
    const navRequest = {
      url: 'https://sunoshop.app/shop',
      mode: 'navigate',
      method: 'GET',
      headers: new Headers({ accept: 'text/html' }),
    } as unknown as Request;

    // Global fetch fails because device is offline
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const response = await handleFetch(navRequest, CACHE_NAME);

    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('SunoShop Shell');
  });

  it('registers service worker when supported by navigator', async () => {
    const registerMock = vi.fn().mockResolvedValue({ scope: '/' });
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { register: registerMock },
      configurable: true,
      writable: true,
    });

    const reg = await registerSW();

    expect(reg).toBeDefined();
    expect(registerMock).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });
});
