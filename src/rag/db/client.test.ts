import { describe, expect, it } from 'vitest';
import { MARGINALIA_SCHEMA, readSupabaseConfig } from './client';

const validEnvironment = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
};

describe('the schema this client talks to', () => {
  it('is rag, never public, which belongs to a different application', () => {
    // This project's `public` schema is owned by an unrelated live application.
    // Pointing at it would be a data-integrity incident, not a bug.
    expect(MARGINALIA_SCHEMA).toBe('rag');
  });
});

describe('reading configuration', () => {
  it('returns the url and key when both are present', () => {
    expect(readSupabaseConfig(validEnvironment)).toEqual({
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_example',
    });
  });

  it('names the missing variable rather than failing later at the first request', () => {
    expect(() => readSupabaseConfig({ SUPABASE_PUBLISHABLE_KEY: 'k' })).toThrow(/SUPABASE_URL/);
    expect(() => readSupabaseConfig({ SUPABASE_URL: 'u' })).toThrow(
      /SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it('treats an empty string as missing, since a blank line in .env reads as one', () => {
    expect(() => readSupabaseConfig({ ...validEnvironment, SUPABASE_URL: '   ' })).toThrow(
      /SUPABASE_URL/,
    );
  });

  it('refuses a secret key, which must never reach a browser bundle', () => {
    // The publishable key is safe to ship because `anon` holds no grant on the
    // rag schema. A service-role key bypasses row-level security entirely, so
    // shipping one would hand every visitor every tenant's documents.
    expect(() =>
      readSupabaseConfig({
        ...validEnvironment,
        SUPABASE_PUBLISHABLE_KEY: 'sb_secret_this_should_never_be_here',
      }),
    ).toThrow(/secret/i);
  });

  it('refuses a legacy service_role JWT for the same reason', () => {
    const serviceRoleShaped = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
      JSON.stringify({ role: 'service_role' }),
    ).toString('base64url')}.signature`;

    expect(() =>
      readSupabaseConfig({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: serviceRoleShaped }),
    ).toThrow(/service_role/i);
  });

  it('accepts a legacy anon JWT, which is what older projects still issue', () => {
    const anonShaped = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
      JSON.stringify({ role: 'anon' }),
    ).toString('base64url')}.signature`;

    expect(() =>
      readSupabaseConfig({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: anonShaped }),
    ).not.toThrow();
  });
});
