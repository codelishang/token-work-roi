import assert from 'node:assert/strict';
import test from 'node:test';
import { U } from '../src/client/shared/utils.js';

test('csvCell escapes spreadsheet formula prefixes', () => {
  assert.equal(U.csvCell('=IMPORTXML("https://example.com")'), '"\'=IMPORTXML(""https://example.com"")"');
  assert.equal(U.csvCell('+cmd|calc'), "'+cmd|calc");
  assert.equal(U.csvCell('-1'), "'-1");
  assert.equal(U.csvCell('@SUM(A1:A2)'), "'@SUM(A1:A2)");
  assert.equal(U.csvCell('\t=SUM(A1:A2)'), "'\t=SUM(A1:A2)");
  assert.equal(U.csvCell('\r=SUM(A1:A2)'), '"\'\r=SUM(A1:A2)"');
});

test('csvCell still applies RFC-style quoting for commas and quotes', () => {
  assert.equal(U.csvCell('safe text'), 'safe text');
  assert.equal(U.csvCell('hello,world'), '"hello,world"');
  assert.equal(U.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(U.csvCell(null), '');
});
