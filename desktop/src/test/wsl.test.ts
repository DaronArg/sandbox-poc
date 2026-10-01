import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { decodeWslOutput } from '../main/wsl';
import { validateRunValues } from '../main/validate';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', name));

test('decodifica la salida real de `wsl -l -q` (UTF-16LE) sin BOM ni NUL', () => {
  const raw = fixture('wsl-list-q.bin');
  assert.ok(raw.includes(0), 'el fixture debe ser UTF-16LE real (con bytes nulos)');
  const text = decodeWslOutput(raw);
  assert.ok(!text.includes('\0') && !text.includes('﻿'));
  const names = text.split(/\r?\n/).map((s) => s.trim().toLowerCase());
  assert.ok(names.includes('ubuntu'), `distros: ${JSON.stringify(names)}`);
});

test('decodifica la salida real de `wsl --status`', () => {
  const text = decodeWslOutput(fixture('wsl-status.bin'));
  assert.ok(text.length > 0 && !text.includes('\0'));
});

test('decodifica el error real de una distro inexistente', () => {
  const text = decodeWslOutput(fixture('wsl-missing-distro.bin'));
  assert.ok(text.length > 0 && !text.includes('\0'));
});

test('la salida UTF-8 (dentro de la distro) no se toca', () => {
  assert.equal(decodeWslOutput(Buffer.from('29.8.2\n', 'utf8')), '29.8.2\n');
  assert.equal(decodeWslOutput(Buffer.alloc(0)), '');
});

test('validateRunValues acepta valores del backend y rechaza inyeccion', () => {
  const ok = { containerName: 'assessment-1-abc123', volume: 'assessment_1_abc123_workspace', image: 'assessment-runtime:poc', token: '123e4567-e89b-12d3-a456-426614174000', containerBackendUrl: 'http://host.docker.internal:9090', sessionId: 1 };
  assert.doesNotThrow(() => validateRunValues(ok));
  assert.throws(() => validateRunValues({ ...ok, containerName: 'a; rm -rf /' }));
  assert.throws(() => validateRunValues({ ...ok, volume: '--privileged' }));
  assert.throws(() => validateRunValues({ ...ok, image: 'Img With Space' }));
  assert.throws(() => validateRunValues({ ...ok, token: 'no-es-uuid' }));
  assert.throws(() => validateRunValues({ ...ok, containerBackendUrl: 'ftp://x' }));
});
