import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { brand } from './brand.ts';

test('publishes the canonical DevPilot product and command names', () => {
  assert.equal(brand.productName, 'DevPilot');
  assert.equal(brand.runtimeCliName, 'devpilot');
  assert.equal(brand.desktopCliName, 'devpilot-app');
  assert.equal(brand.desktopDevCliName, 'devpilot-app-dev');
  assert.notEqual(brand.desktopCliName, brand.runtimeCliName);
});

test('Tauri production identity matches the central brand', () => {
  const configPath = resolve(process.cwd(), 'apps/ui/src-tauri/tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.productName, brand.productName);
  assert.equal(config.identifier, brand.desktopIdentifier);
  assert.equal(config.app.windows[0].title, brand.productName);
});

test('desktop updater config does not reference Happier infrastructure', () => {
  for (const fileName of [
    'tauri.conf.json',
    'tauri.preview.conf.json',
    'tauri.publicdev.conf.json',
  ]) {
    const configPath = resolve(process.cwd(), 'apps/ui/src-tauri', fileName);
    const contents = readFileSync(configPath, 'utf8');
    assert.doesNotMatch(contents, /github\.com\/happier-dev\/happier\/releases/i);
  }
});
