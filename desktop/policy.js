// SPDX-License-Identifier: GPL-3.0-only
// Pure policy decisions for the SLOOP editor desktop app.
// No Electron import: this module is unit-tested under plain node.
'use strict';

const path = require('node:path');

const APP_SCHEME = 'sloop';
const APP_HOST = 'editor';

// Resolve a URL pathname to a file inside root. Returns null if the path
// escapes root, or names root itself.
function resolveWithinRoot(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    return null; // malformed percent-encoding
  }
  const rooted = decoded.startsWith('/') ? decoded : '/' + decoded;
  const target = path.resolve(root, '.' + rooted);
  const rel = path.relative(root, target);
  // rel === '' means target is root itself; '..'-prefixed means it escaped.
  // The path.sep check stops /srv/app-evil passing as inside /srv/app.
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return null;
  }
  return target;
}

// NOTE: deliberately not URL.origin — Node's WHATWG parser reports the origin
// of any non-special scheme (such as sloop:) as the string "null".
function isAppUrl(u) {
  if (typeof u !== 'string' || u === '') return false;
  let parsed;
  try {
    parsed = new URL(u);
  } catch (e) {
    return false;
  }
  return parsed.protocol === APP_SCHEME + ':' && parsed.host === APP_HOST;
}

function allowPermission(permission, requestingUrl) {
  if (permission !== 'midi' && permission !== 'midiSysex') return false;
  return isAppUrl(requestingUrl);
}

module.exports = { APP_SCHEME, APP_HOST, resolveWithinRoot, isAppUrl, allowPermission };
