import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionKey, buildTableRowKey, createUniqueRowKeyFactory } from '../src/client/dashboard/table-keys.js';

test('table row keys do not collapse missing session identity into undefined key', () => {
  const key = buildSessionKey({ source: '<synthetic>' });
  assert.equal(key, 'unknown-device::<synthetic>::unknown-session');
  assert.doesNotMatch(key, /undefined---|undefined::undefined/u);
});

test('unique row key factory disambiguates repeated synthetic rows', () => {
  const rowKey = createUniqueRowKeyFactory((row, index) => buildTableRowKey(row, index, 'sessions'));
  const keys = [
    rowKey({ source: '<synthetic>' }, 0),
    rowKey({ source: '<synthetic>' }, 1),
    rowKey({ source: '<synthetic>' }, 2)
  ];
  assert.deepEqual(keys, [
    'sessions::<synthetic>',
    'sessions::<synthetic>#1',
    'sessions::<synthetic>#2'
  ]);
});

test('aggregation rows get stable keys from semantic fields', () => {
  assert.equal(
    buildTableRowKey({
      project: 'AIResume',
      taskType: '功能开发',
      outputStatus: '已完成',
      workPurpose: '功能开发',
      workStage: '实现',
      valueLevel: '高'
    }, 0, 'attribution'),
    'attribution::AIResume::功能开发::已完成::功能开发::实现::高'
  );
});

test('alias rule and completely empty rows remain unique', () => {
  assert.equal(buildTableRowKey({ id: 7, pattern: 'D:\\Repo' }, 0, 'aliasRules'), 'rule-7');
  const rowKey = createUniqueRowKeyFactory((row, index) => buildTableRowKey(row, index, 'models'));
  assert.deepEqual([rowKey({}, 0), rowKey({}, 1)], ['models', 'models#1']);
});
