'use strict';
// scripts/zip.mjs: the plain-Node zip writer pack.mjs uses (it used python3, which stamped every entry with the
// file's modification time, so two builds of one commit had different checksums).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const load = () => import('../scripts/zip.mjs');

// A small independent reader: end record, central directory, then each entry's data checked against its CRC.
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  assert.equal(start + size, end, 'the directory ends where the end record begins');
  const out = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const method = buffer.readUInt16LE(at + 10), crc = buffer.readUInt32LE(at + 16), csize = buffer.readUInt32LE(at + 20), usize = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), localAt = buffer.readUInt32LE(at + 42), mode = buffer.readUInt32LE(at + 38) >>> 16;
    const date = buffer.readUInt16LE(at + 14), time = buffer.readUInt16LE(at + 12);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(localAt), 0x04034b50);
    const dataAt = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    const body = buffer.subarray(dataAt, dataAt + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.equal(data.length, usize, name);
    out.push({ name, data, crc, mode, date, time, method });
    at += 46 + nameLength;
  }
  return out;
}

test('every file comes back byte for byte, with a correct CRC, in sorted order', async () => {
  const { zipBuffer, crc32 } = await load();
  const big = Buffer.from('ingredient '.repeat(5000));
  const noise = randomBytes(2000);
  const entries = [
    { name: 'src/b.js', data: Buffer.from('b') }, { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'vendor/big.txt', data: big }, { name: 'icons/noise.bin', data: noise }, { name: 'src/ünï.txt', data: Buffer.from('utf8 name') }, { name: 'empty', data: Buffer.alloc(0) },
  ];
  const read = readZip(zipBuffer(entries));
  assert.deepEqual(read.map(e => e.name), entries.map(e => e.name).sort());
  for (const e of read) {
    const source = entries.find(x => x.name === e.name);
    assert.ok(e.data.equals(source.data), e.name);
    assert.equal(e.crc, crc32(source.data), `${e.name} crc`);
    assert.equal(e.mode, 0o100644);
  }
  assert.equal(read.find(e => e.name === 'vendor/big.txt').method, 8, 'compressible data is deflated');
  assert.equal(read.find(e => e.name === 'icons/noise.bin').method, 0, 'incompressible data is stored');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
});

test('the same files give the same bytes, whatever order they arrive in and whenever they were built', async () => {
  const { zipBuffer } = await load();
  const entries = [{ name: 'a', data: Buffer.from('one') }, { name: 'c/d', data: Buffer.from('two') }, { name: 'b', data: Buffer.from('three') }];
  const first = zipBuffer(entries);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.ok(zipBuffer([...entries].reverse()).equals(first));
  for (const e of readZip(first)) assert.deepEqual([e.date, e.time], [0x21, 0], 'the zip epoch, not the clock');
});

test('a folder is zipped with relative paths, and other tools can read the result', async () => {
  const { zipFolder } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(dir, 'src', 'deep', 'x.js'), 'x'.repeat(4000));
    const out = path.join(os.tmpdir(), `zip-test-${process.pid}.zip`);
    zipFolder(dir, out);
    assert.deepEqual(readZip(fs.readFileSync(out)).map(e => e.name), ['manifest.json', 'src/deep/x.js']);
    const python = spawnSync('python3', ['-I', '-m', 'zipfile', '-t', out], { encoding: 'utf8' });
    if (!python.error) assert.equal(python.status, 0, python.stderr);
    fs.rmSync(out, { force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
