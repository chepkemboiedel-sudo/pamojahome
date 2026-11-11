import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicEnv } from './env';

describe('publicEnv.siteUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('prefers NEXT_PUBLIC_SITE_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pamoja.example');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'pamojahome.vercel.app');
    expect(publicEnv.siteUrl()).toBe('https://pamoja.example');
  });

  it("falls back to Vercel's production domain", () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'pamojahome.vercel.app');
    expect(publicEnv.siteUrl()).toBe('https://pamojahome.vercel.app');
  });

  it('defaults to localhost', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    expect(publicEnv.siteUrl()).toBe('http://localhost:3000');
  });
});
