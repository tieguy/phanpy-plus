import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Guard for the phanpy-plus -> fleeting-social rename.
//
// `PHANPY_` (uppercase + underscore) is only ever an env-var name or the
// `__PHANPY_COMMIT_HASH__` sentinel — it must all become `FLEETING_`.
// `Phanpy+` is the old display/brand name — it must become `Fleeting`.
//
// Deliberately NOT flagged (legitimate upstream/heritage, lowercase or
// unqualified): `phanpy.social`, `@phanpy`, `cheeaun/phanpy`,
// `<phanpy-shortcuts-settings>` (bio-sync marker — renaming breaks users),
// and `src/data/mock-posts.json` demo content.

const ROOT = join(import.meta.dirname, '..', '..');

const SCAN_FILES = [
  'vite.config.js',
  'rollbar.js',
  'env.schema.json',
  '.env',
  '.env.production',
  'package.json',
  'wrangler.jsonc',
  'index.html',
  'compose/index.html',
];

// Recursively collect src/**/*.{js,jsx} except locales and mock data.
function collectSrc(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (full.includes('/locales') || full.endsWith('mock-posts.json')) continue;
    const s = statSync(full);
    if (s.isDirectory()) collectSrc(full, acc);
    else if (
      /\.(js|jsx)$/.test(entry) &&
      !full.endsWith('rename-guard.test.js')
    )
      acc.push(full);
  }
  return acc;
}

const files = [
  ...SCAN_FILES.map((f) => join(ROOT, f)),
  ...collectSrc(join(ROOT, 'src')),
];

function read(f) {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return ''; // optional file (e.g. local .env) may be absent
  }
}

describe('rename guard: no stale phanpy identifiers', () => {
  it('has no PHANPY_ env prefix anywhere', () => {
    const offenders = files.filter((f) => /PHANPY_/.test(read(f)));
    expect(offenders.map((f) => f.replace(ROOT + '/', ''))).toEqual([]);
  });

  it('has no "Phanpy+" brand string anywhere', () => {
    const offenders = files.filter((f) => read(f).includes('Phanpy+'));
    expect(offenders.map((f) => f.replace(ROOT + '/', ''))).toEqual([]);
  });

  it('env.schema.json default client name is "Fleeting"', () => {
    const schema = JSON.parse(read(join(ROOT, 'env.schema.json')));
    expect(schema.properties.PHANPY_CLIENT_NAME).toBeUndefined();
    expect(schema.properties.FLEETING_CLIENT_NAME?.default).toBe('Fleeting');
  });
});
