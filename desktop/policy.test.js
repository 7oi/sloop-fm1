// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolveWithinRoot, allowPermission, isAppUrl, classifyRequest } = require('./policy.js');

const ROOT = '/srv/app';

// classifyRequest decides the response without touching Electron, so the
// 404/400 paths are testable. `exists` is injected.
const present = () => true;
const absent = () => false;
const req = (pathname, opts = {}) => classifyRequest({
  root: ROOT,
  host: opts.host === undefined ? 'editor' : opts.host,
  pathname,
  index: 'editor.html',
  exists: opts.exists || present
});

test('classifyRequest serves an existing file', () => {
  assert.deepStrictEqual(req('/editor.html'),
    { status: 200, file: path.join(ROOT, 'editor.html') });
});

test('classifyRequest maps / to the index', () => {
  assert.deepStrictEqual(req('/'),
    { status: 200, file: path.join(ROOT, 'editor.html') });
});

// The editor references ../sloop.webmanifest and ../icon-192.png, which do
// not exist in the app. They must 404 cleanly, not reject.
test('classifyRequest 404s a missing file instead of throwing', () => {
  assert.deepStrictEqual(req('/sloop.webmanifest', { exists: absent }),
    { status: 404, file: null });
});

test('classifyRequest 400s a traversal attempt', () => {
  assert.deepStrictEqual(req('/../../../etc/passwd'),
    { status: 400, file: null });
});

test('classifyRequest 404s an unknown host', () => {
  assert.deepStrictEqual(req('/editor.html', { host: 'evil' }),
    { status: 404, file: null });
});

// Review Focus 4: a query string must not reach the filesystem path.
test('classifyRequest ignores a query string already stripped by URL parsing', () => {
  assert.deepStrictEqual(req('/editor.html'),
    { status: 200, file: path.join(ROOT, 'editor.html') });
});

test('resolveWithinRoot resolves a plain file', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/editor.html'), path.join(ROOT, 'editor.html'));
});

test('resolveWithinRoot resolves a nested file', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/sub/x.js'), path.join(ROOT, 'sub', 'x.js'));
});

test('resolveWithinRoot decodes percent-encoding', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/a%20b.txt'), path.join(ROOT, 'a b.txt'));
});

// Review Focus 1: path traversal
test('resolveWithinRoot rejects traversal', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/../../../etc/passwd'), null);
});

test('resolveWithinRoot rejects encoded traversal', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/%2e%2e/%2e%2e/etc/passwd'), null);
});

test('resolveWithinRoot rejects a sibling-prefix escape', () => {
  // /srv/app-evil must not count as inside /srv/app
  assert.strictEqual(resolveWithinRoot(ROOT, '/../app-evil/x'), null);
});

test('resolveWithinRoot rejects the root itself', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/'), null);
});

test('resolveWithinRoot rejects a malformed escape sequence', () => {
  assert.strictEqual(resolveWithinRoot(ROOT, '/%ZZ'), null);
});

test('isAppUrl accepts the app origin', () => {
  assert.strictEqual(isAppUrl('sloop://editor/editor.html'), true);
});

test('isAppUrl rejects another host on the same scheme', () => {
  assert.strictEqual(isAppUrl('sloop://evil/editor.html'), false);
});

test('isAppUrl rejects http, null, undefined and junk', () => {
  assert.strictEqual(isAppUrl('https://hugelton.com'), false);
  assert.strictEqual(isAppUrl(null), false);
  assert.strictEqual(isAppUrl(undefined), false);
  assert.strictEqual(isAppUrl(''), false);
  assert.strictEqual(isAppUrl('not a url'), false);
});

test('allowPermission grants midi and midiSysex from the app origin', () => {
  assert.strictEqual(allowPermission('midi', 'sloop://editor/editor.html'), true);
  assert.strictEqual(allowPermission('midiSysex', 'sloop://editor/editor.html'), true);
});

test('allowPermission accepts a bare origin string', () => {
  // setPermissionCheckHandler passes "sloop://editor", not a full URL
  assert.strictEqual(allowPermission('midiSysex', 'sloop://editor'), true);
});

// Review Focus 2: foreign origin
test('allowPermission denies midi from a foreign origin', () => {
  assert.strictEqual(allowPermission('midi', 'https://hugelton.com'), false);
  assert.strictEqual(allowPermission('midiSysex', 'https://hugelton.com'), false);
});

// Review Focus 3: other permissions from our own origin
test('allowPermission denies non-MIDI permissions from the app origin', () => {
  for (const p of ['geolocation', 'media', 'notifications', 'usb', 'serial', 'hid', 'openExternal']) {
    assert.strictEqual(allowPermission(p, 'sloop://editor/editor.html'), false, p);
  }
});

test('allowPermission denies when the origin is missing', () => {
  assert.strictEqual(allowPermission('midi', undefined), false);
  assert.strictEqual(allowPermission('midi', null), false);
});
