// How the content scripts read another page of the store (src/stores/cart.js): what counts as a block page,
// and which responses are refused before they are parsed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/engine/db/_module.js');
globalThis.AIR = globalThis.AIR || {};
AIR.stores = { storeForHost: () => null };
const cart = require('../src/stores/cart.js');

// A document with just what isChallenge reads.
const page = (title, h1) => ({ title, querySelector: sel => (sel === 'h1' && h1 != null ? { textContent: h1 } : null) });

test('block pages are recognised by what the stores print, not by a word in a product name', () => {
  for (const [title, h1] of [['Robot Check', ''], ['Amazon.com', 'Enter the characters you see below'], ['Amazon.com', 'Type the characters you see in this image'],
    ['Robot or human?', ''], ['Just a moment...', ''], ['Access Denied', ''], ['Amazon.com', 'Press and hold the button to confirm you are a human'],
    ['Security Verification', ''], ['Verify you are human', ''], ['', 'Sorry, we just need to make sure you are not a robot']]) {
    assert.equal(cart.isChallenge(page(title, h1)), true, `${title} / ${h1}`);
  }
  // Words that appear in real food listings.
  for (const [title, h1] of [['Amazon.com: Dinosaur and Robot Shaped Pasta, 12 oz', 'Dinosaur and Robot Shaped Pasta'], ['Amazon.com: Captcha Hot Sauce', 'Captcha Hot Sauce'],
    ['Amazon.com: Quaker Rolled Oats', 'Quaker Rolled Oats'], ['Target : Granola', 'Granola']]) {
    assert.equal(cart.isChallenge(page(title, h1)), false, `${title}`);
  }
});

const response = ({ ok = true, type = 'text/html; charset=utf-8', length, chunks, text } = {}) => {
  let cancelled = false, index = 0;
  const res = {
    ok, headers: { get: name => ({ 'content-type': type, 'content-length': length }[name.toLowerCase()] ?? null) },
    text: async () => text ?? chunks.map(c => Buffer.from(c).toString()).join(''),
    cancelled: () => cancelled,
  };
  if (chunks) res.body = { getReader: () => ({ read: async () => (index < chunks.length ? { done: false, value: Buffer.from(chunks[index++]) } : { done: true }), cancel: async () => { cancelled = true; } }) };
  return res;
};

test('an error status, another content type or an oversize length is refused before the body is read', async () => {
  for (const res of [response({ ok: false, chunks: ['x'] }), response({ type: 'application/json', chunks: ['{}'] }), response({ length: String(cart.MAX_PAGE_BYTES + 1), chunks: ['x'] })]) {
    await assert.rejects(cart.readHtml(res), /unavailable/);
  }
  // Without a content type or length (a mock, or a store that sends neither) the body decides.
  assert.equal(await cart.readHtml(response({ type: '', chunks: ['<html>ok</html>'] })), '<html>ok</html>');
  assert.equal(await cart.readHtml({ ok: true, text: async () => '<p>plain</p>' }), '<p>plain</p>', 'a response with no streaming body');
});

test('a body with no length cannot be buffered past the limit, and an abort stops the read', async () => {
  const big = response({ chunks: ['aaaa', 'bbbb', 'cccc'] });
  await assert.rejects(cart.readHtml(big, undefined, 6), /unavailable/);
  assert.equal(big.cancelled(), true, 'the reader is released');
  await assert.rejects(cart.readHtml({ ok: true, text: async () => 'x'.repeat(10) }, undefined, 5), /unavailable/);
  const controller = new AbortController();
  const slow = response({ chunks: ['a', 'b'] });
  const reader = slow.body.getReader;
  slow.body.getReader = () => { const r = reader(); const read = r.read; r.read = async () => { controller.abort(); return read(); }; return r; };
  await assert.rejects(cart.readHtml(slow, controller.signal), /unavailable/);
});

test('multi-byte text split across chunks decodes whole', async () => {
  const bytes = Buffer.from('<p>Zutaten: Haferflocken – Zucker, Käse</p>');
  const cut = bytes.indexOf(Buffer.from('–')) + 1;   // inside the three-byte dash
  const res = response({ chunks: [bytes.subarray(0, cut), bytes.subarray(cut)] });
  assert.equal(await cart.readHtml(res), '<p>Zutaten: Haferflocken – Zucker, Käse</p>');
});

test('publicDocument parses a page, and marks a block page so the caller can stop', async () => {
  // Node has no DOMParser; a document is all publicDocument hands on, so a stand-in that reads the title and heading will do.
  globalThis.DOMParser = class { parseFromString(html) { return page((html.match(/<title>(.*?)<\/title>/) || [])[1] || '', (html.match(/<h1>(.*?)<\/h1>/) || [])[1]); } };
  try {
    const ok = await cart.publicDocument(response({ chunks: ['<title>Amazon.com: Rolled Oats</title><h1>Rolled Oats</h1>'] }));
    assert.equal(ok.title, 'Amazon.com: Rolled Oats');
    await assert.rejects(cart.publicDocument(response({ chunks: ['<title>Robot Check</title>'] })), error => error.message === 'blocked' && error.blocked === true);
    await assert.rejects(cart.publicDocument(response({ ok: false, chunks: ['x'] })), error => error.message === 'unavailable' && !error.blocked);
  } finally { delete globalThis.DOMParser; }
});
