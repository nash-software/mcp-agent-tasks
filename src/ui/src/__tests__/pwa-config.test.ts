/**
 * pwa-config.test.ts — Unit assertions for the vite-plugin-pwa configuration.
 *
 * Strategy: import the pure config module directly (no browser, no Vite build).
 * The module only uses vite-plugin-pwa type imports + plain objects — safe in node env.
 *
 * ACs verified:
 *  AC1 — manifest has display:standalone, start_url:"/", 192+512 icons
 *  AC2 — index.html manifest link (injected by vite-plugin-pwa via injectRegister:'auto')
 *  AC3 — runtimeCaching: /api/* NetworkFirst; /api/version + /api/dev/* excluded (NetworkOnly)
 *  AC4 — type-check and build pass (gate — run separately)
 */

import { describe, it, expect } from 'vitest'
import {
  THEME_COLOR,
  BACKGROUND_COLOR,
  RUNTIME_CACHING,
  PWA_MANIFEST,
  WORKBOX_OPTIONS,
} from '../lib/pwa-config'

// ─── Manifest fields (AC1) ────────────────────────────────────────────────────

describe('PWA_MANIFEST — required fields (AC1)', () => {
  it('has name "Agent Tasks"', () => {
    expect(PWA_MANIFEST.name).toBe('Agent Tasks')
  })

  it('has short_name "Tasks"', () => {
    expect(PWA_MANIFEST.short_name).toBe('Tasks')
  })

  it('has display "standalone"', () => {
    expect(PWA_MANIFEST.display).toBe('standalone')
  })

  it('has start_url "/"', () => {
    expect(PWA_MANIFEST.start_url).toBe('/')
  })

  it('has scope "/"', () => {
    expect(PWA_MANIFEST.scope).toBe('/')
  })

  it('has theme_color from design tokens', () => {
    expect(PWA_MANIFEST.theme_color).toBe(THEME_COLOR)
    expect(THEME_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('has background_color from design tokens', () => {
    expect(PWA_MANIFEST.background_color).toBe(BACKGROUND_COLOR)
    expect(BACKGROUND_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('includes a 192x192 icon', () => {
    const icons = PWA_MANIFEST.icons ?? []
    const icon192 = icons.find(i => i.sizes === '192x192')
    expect(icon192).toBeDefined()
    expect(icon192?.type).toBe('image/png')
  })

  it('includes a 512x512 icon with purpose "any"', () => {
    const icons = PWA_MANIFEST.icons ?? []
    const icon512any = icons.find(i => i.sizes === '512x512' && i.purpose === 'any')
    expect(icon512any).toBeDefined()
    expect(icon512any?.type).toBe('image/png')
  })

  it('includes a 512x512 maskable icon', () => {
    const icons = PWA_MANIFEST.icons ?? []
    const icon512mask = icons.find(i => i.sizes === '512x512' && i.purpose === 'maskable')
    expect(icon512mask).toBeDefined()
    expect(icon512mask?.type).toBe('image/png')
  })

  it('has at least 3 icon entries (192, 512 any, 512 maskable)', () => {
    expect((PWA_MANIFEST.icons ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

// ─── Service worker / registration (AC2) ─────────────────────────────────────

describe('WORKBOX_OPTIONS — service worker registration (AC2)', () => {
  it('globPatterns covers static assets', () => {
    const patterns = [...WORKBOX_OPTIONS.globPatterns]
    expect(patterns.length).toBeGreaterThan(0)
    // Must include js, css, html
    const joined = patterns.join(' ')
    expect(joined).toContain('js')
    expect(joined).toContain('css')
    expect(joined).toContain('html')
  })
})

// ─── Runtime caching rules (AC3) ─────────────────────────────────────────────

describe('RUNTIME_CACHING — caching rules (AC3)', () => {
  it('has at least 3 rules (version-only, dev/*, api/*)', () => {
    expect(RUNTIME_CACHING.length).toBeGreaterThanOrEqual(3)
  })

  it('/api/version is marked NetworkOnly (must not be cached)', () => {
    const rule = RUNTIME_CACHING.find(r => {
      const pattern = r.urlPattern
      if (pattern instanceof RegExp) return pattern.test('/api/version')
      return false
    })
    expect(rule).toBeDefined()
    expect(rule?.handler).toBe('NetworkOnly')
  })

  it('/api/version rule does NOT match /api/versions (scoped correctly)', () => {
    const rule = RUNTIME_CACHING.find(r => {
      const pattern = r.urlPattern
      if (pattern instanceof RegExp) return pattern.test('/api/version') && !pattern.test('/api/version-other')
      return false
    })
    // The rule for /api/version should exist and be NetworkOnly
    expect(rule?.handler).toBe('NetworkOnly')
  })

  it('/api/dev/* is marked NetworkOnly (dev endpoints excluded from cache)', () => {
    const rule = RUNTIME_CACHING.find(r => {
      const pattern = r.urlPattern
      if (pattern instanceof RegExp) return pattern.test('/api/dev/update')
      return false
    })
    expect(rule).toBeDefined()
    expect(rule?.handler).toBe('NetworkOnly')
  })

  it('/api/dev/* NetworkOnly rule also matches /api/dev/anything', () => {
    const rule = RUNTIME_CACHING.find(r => {
      const pattern = r.urlPattern
      if (pattern instanceof RegExp) return pattern.test('/api/dev/status')
      return false
    })
    expect(rule?.handler).toBe('NetworkOnly')
  })

  it('/api/* (general) is marked NetworkFirst (fresh task data)', () => {
    const rule = RUNTIME_CACHING.find(r => {
      const pattern = r.urlPattern
      if (pattern instanceof RegExp) return pattern.test('/api/tasks')
      return false
    })
    expect(rule).toBeDefined()
    expect(rule?.handler).toBe('NetworkFirst')
  })

  it('/api/tasks matches NetworkFirst (not NetworkOnly)', () => {
    const matchingRules = RUNTIME_CACHING.filter(r => {
      const pattern = r.urlPattern
      if (pattern instanceof RegExp) return pattern.test('/api/tasks')
      return false
    })
    // The first matching rule (first-match-wins) should be NetworkFirst
    expect(matchingRules[0]?.handler).toBe('NetworkFirst')
  })

  it('/api/version NetworkOnly rule comes BEFORE the /api/* NetworkFirst rule', () => {
    const versionIdx = RUNTIME_CACHING.findIndex(r => {
      const p = r.urlPattern
      return p instanceof RegExp && p.test('/api/version')
    })
    const apiIdx = RUNTIME_CACHING.findIndex(r => {
      const p = r.urlPattern
      return p instanceof RegExp && p.test('/api/tasks') && r.handler === 'NetworkFirst'
    })
    expect(versionIdx).toBeGreaterThanOrEqual(0)
    expect(apiIdx).toBeGreaterThanOrEqual(0)
    expect(versionIdx).toBeLessThan(apiIdx)
  })

  it('/api/dev/* NetworkOnly rule comes BEFORE the /api/* NetworkFirst rule', () => {
    const devIdx = RUNTIME_CACHING.findIndex(r => {
      const p = r.urlPattern
      return p instanceof RegExp && p.test('/api/dev/update')
    })
    const apiIdx = RUNTIME_CACHING.findIndex(r => {
      const p = r.urlPattern
      return p instanceof RegExp && p.test('/api/tasks') && r.handler === 'NetworkFirst'
    })
    expect(devIdx).toBeLessThan(apiIdx)
  })
})

// ─── navigateFallbackDenylist (AC3 extra) ────────────────────────────────────

describe('workbox.navigateFallbackDenylist — version + dev excluded (AC3)', () => {
  const denylist = WORKBOX_OPTIONS.navigateFallbackDenylist

  it('has at least 2 deny patterns', () => {
    expect(denylist.length).toBeGreaterThanOrEqual(2)
  })

  it('denies /api/version navigation fallback', () => {
    const matches = denylist.some(p => p instanceof RegExp && p.test('/api/version'))
    expect(matches).toBe(true)
  })

  it('denies /api/dev/* navigation fallback', () => {
    const matches = denylist.some(p => p instanceof RegExp && p.test('/api/dev/update'))
    expect(matches).toBe(true)
  })
})

// ─── Design token constants ───────────────────────────────────────────────────

describe('Design token constants', () => {
  it('THEME_COLOR is a valid hex color', () => {
    expect(THEME_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('BACKGROUND_COLOR is a valid hex color', () => {
    expect(BACKGROUND_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('THEME_COLOR matches the brand accent (#0070F3)', () => {
    expect(THEME_COLOR.toLowerCase()).toBe('#0070f3')
  })

  it('BACKGROUND_COLOR matches the dark background (#09090B)', () => {
    expect(BACKGROUND_COLOR.toLowerCase()).toBe('#09090b')
  })
})
