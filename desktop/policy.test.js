// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolveWithinRoot, allowPermission, isAppUrl } = require('./policy.js');

const ROOT = '/srv/app';

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
