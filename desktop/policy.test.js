// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  resolveWithinRoot, allowPermission, isAppUrl, classifyRequest, isAllowedNavigation
} = require('./policy.js');

const ROOT = '/srv/app';
const INDEX = 'editor.html';

// classifyRequest decides the response without touching Electron, so the
// 404/400 paths are testable. `isFile` is injected.
const present = () => true;
const absent = () => false;
const req = (pathname, opts = {}) => classifyRequest({
  root: ROOT,
  host: opts.host === undefined ? 'editor' : opts.host,
  pathname,
  index: INDEX,
  isFile: opts.isFile || present
});

// Goes through new URL() exactly as main.js does, so these exercise the real
// pipeline rather than a hand-written pathname the parser could never emit.
const viaUrl = (urlStr, opts = {}) => {
  const u = new URL(urlStr);
  return classifyRequest({
    root: ROOT,
    host: u.host,
    pathname: u.pathname,
    index: INDEX,
    isFile: opts.isFile || present
  });
};

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
  assert.deepStrictEqual(req('/sloop.webmanifest', { isFile: absent }),
    { status: 404, file: null });
});

// fs.existsSync is true for a directory, but net.fetch rejects on a
// directory file:// URL — the same unhandled-rejection class as a missing
// file. Only regular files may reach net.fetch.
test('classifyRequest 404s a directory', () => {
  assert.deepStrictEqual(req('/sub', { isFile: absent }),
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

// --- the real pipeline, starting from URL strings ---

// Review Focus 1, done honestly. WHATWG URL parsing collapses the dot
// segments before we ever see them, so the observable answer is a 404 on the
// clamped path -- not the 400 the pathname-level test implies.
test('traversal in a real URL is clamped by URL parsing, then 404s', () => {
  assert.deepStrictEqual(viaUrl('sloop://editor/../../../etc/passwd', { isFile: absent }),
    { status: 404, file: null });
});

// This one survives URL normalization as literal text and must be caught by
// resolveWithinRoot after decoding.
test('percent-encoded traversal survives URL parsing and is rejected with 400', () => {
  assert.deepStrictEqual(viaUrl('sloop://editor/..%2f..%2fetc/passwd'),
    { status: 400, file: null });
});

// Review Focus 4, with an actual query string in it.
test('a query string is stripped before the filesystem lookup', () => {
  assert.deepStrictEqual(viaUrl('sloop://editor/editor.html?x=1&y=2'),
    { status: 200, file: path.join(ROOT, INDEX) });
});

test('a fragment is stripped before the filesystem lookup', () => {
  assert.deepStrictEqual(viaUrl('sloop://editor/editor.html#sound'),
    { status: 200, file: path.join(ROOT, INDEX) });
});

// --- navigation confinement ---

test('isAllowedNavigation allows the index', () => {
  assert.strictEqual(isAllowedNavigation('sloop://editor/editor.html', INDEX), true);
});

test('isAllowedNavigation allows the bare root', () => {
  assert.strictEqual(isAllowedNavigation('sloop://editor/', INDEX), true);
});

test('isAllowedNavigation allows the index with a query or fragment', () => {
  assert.strictEqual(isAllowedNavigation('sloop://editor/editor.html#sound', INDEX), true);
  assert.strictEqual(isAllowedNavigation('sloop://editor/editor.html?x=1', INDEX), true);
});

// The editor's sidebar links to ../installer/, which is in-scheme but has no
// target here. Letting it navigate replaces the whole window with a plain
// "not found" page, and the app has no Back control to escape it.
test('isAllowedNavigation blocks the dead in-scheme installer link', () => {
  assert.strictEqual(isAllowedNavigation('sloop://editor/installer/', INDEX), false);
});

test('isAllowedNavigation blocks external and foreign-host URLs', () => {
  assert.strictEqual(isAllowedNavigation('https://hugelton.com', INDEX), false);
  assert.strictEqual(isAllowedNavigation('sloop://evil/editor.html', INDEX), false);
  assert.strictEqual(isAllowedNavigation('file:///etc/passwd', INDEX), false);
  assert.strictEqual(isAllowedNavigation('not a url', INDEX), false);
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

// The editor's LIVE page calls requestFullscreen(), and its copy buttons want
// the async clipboard. Denying these silently breaks working editor features.
test('allowPermission grants fullscreen and clipboard writes from the app origin', () => {
  assert.strictEqual(allowPermission('fullscreen', 'sloop://editor/editor.html'), true);
  assert.strictEqual(allowPermission('clipboard-sanitized-write', 'sloop://editor/editor.html'), true);
});

test('allowPermission denies fullscreen and clipboard writes from a foreign origin', () => {
  assert.strictEqual(allowPermission('fullscreen', 'https://hugelton.com'), false);
  assert.strictEqual(allowPermission('clipboard-sanitized-write', 'https://hugelton.com'), false);
});

// Reading the clipboard is not something the editor needs.
test('allowPermission denies clipboard-read from the app origin', () => {
  assert.strictEqual(allowPermission('clipboard-read', 'sloop://editor/editor.html'), false);
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
