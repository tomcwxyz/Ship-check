import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

test('desktop brand is aligned with the playground instead of the old orange survey mark', () => {
  const index = read('index.html');
  const desktop = read('playground-alignment.css');
  assert.match(index, /playground-alignment\.css/);
  assert.match(index, /brand-mark" aria-hidden="true">✳/);
  assert.match(index, /ship<span class="muted-mark">\/<\/span>check/);
  assert.match(desktop, /--accent:\s*var\(--lime\)/);
  assert.match(desktop, /\.brand-mark::before/);
  assert.match(desktop, /display:\s*none/);
  assert.ok(index.indexOf('overview.css') < index.indexOf('playground-alignment.css'));
});

test('all three surfaces share the same stable visual palette', () => {
  const root = fs.readFileSync(new URL('../../../design/ship-check-theme.css', import.meta.url), 'utf8');
  for (const name of ['apps/desktop/ui', 'playground/app', 'apps/cloud/app']) {
    const copy = fs.readFileSync(new URL('../../../' + name + '/ship-check-theme.css', import.meta.url), 'utf8');
    assert.equal(copy, root, name + ' must use canonical Ship Check tokens');
  }
  const desktop = read('playground-alignment.css');
  const playground = fs.readFileSync(new URL('../../../playground/app/globals.css', import.meta.url), 'utf8');
  const cloud = fs.readFileSync(new URL('../../../apps/cloud/app/globals.css', import.meta.url), 'utf8');
  for (const sheet of [desktop, playground, cloud]) {
    assert.match(sheet, /ship-check-theme\.css/);
  }
  assert.doesNotMatch(desktop, /fonts\.googleapis\.com/, 'Desktop must not fetch remote fonts to render');
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
