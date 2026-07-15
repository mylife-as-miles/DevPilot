import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { resolve } from 'node:path';

import { brand } from './brand.ts';

const require = createRequire(import.meta.url);

test('publishes the canonical DevPilot product and command names', () => {
  assert.equal(brand.productName, 'DevPilot');
  assert.equal(brand.runtimeCliName, 'devpilot');
  assert.equal(brand.desktopCliName, 'devpilot-app');
  assert.equal(brand.desktopDevCliName, 'devpilot-app-dev');
  assert.notEqual(brand.desktopCliName, brand.runtimeCliName);
});

test('Electron production identity matches the central brand', () => {
  const packagePath = resolve(process.cwd(), 'apps/electron/package.json');
  const electronPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
  const configPath = resolve(process.cwd(), 'apps/electron/forge.config.cjs');
  const config = require(configPath);
  assert.equal(electronPackage.name, '@devpilot/electron');
  assert.equal(config.packagerConfig.name, brand.productName);
  assert.equal(config.packagerConfig.appBundleId, brand.desktopIdentifier);
});

test('Electron packaging does not reference Happier infrastructure', () => {
  const configPath = resolve(process.cwd(), 'apps/electron/forge.config.cjs');
  const contents = readFileSync(configPath, 'utf8');
  assert.doesNotMatch(contents, /happier-dev\/happier\/releases/i);
  assert.doesNotMatch(contents, /autoUpdater/i);
});
