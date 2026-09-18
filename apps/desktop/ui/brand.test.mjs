import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

test('alpha.8 loads the Ship Check brand layer', () => {
  const alpha8 = read('alpha8.css');
  const brand = read('ship-check-brand.css');

  assert.match(alpha8, /@import\s+url\(["']\.\/ship-check-brand\.css["']\)/);
  assert.match(brand, /--accent:\s*#f2633a;/i);
  assert.match(brand, /\.brand-mark::before/);
  assert.match(brand, /\.brand-mark::after/);
});

test('front door carries the evidence contract rather than the old tick motif', () => {
  const index = read('index.html');

  assert.doesNotMatch(index, />\s*✓\s*</);
  assert.match(index, /class="inspection-strip"/);
  assert.match(index, /Evidence, wherever it lives/);
  assert.match(index, /Uncertainty shown/);
  assert.match(index, /No safety score/);
  assert.match(index, /data-source="archive"/);
  assert.match(index, /data-source="runtime"/);
});

test('cross-source resolution stays explicit in the review language', () => {
  const components = read('components.js');

  assert.match(components, /Established by other evidence/);
  assert.match(components, /Answers source question/);
  assert.match(components, /Source question established/);
});

test('brand interaction layer preserves visible focus and reduced motion', () => {
  const alpha8 = read('alpha8.css');

  assert.match(alpha8, /button:focus-visible/);
  assert.match(alpha8, /summary:focus-visible/);
  assert.match(alpha8, /prefers-reduced-motion:\s*reduce/);
});
