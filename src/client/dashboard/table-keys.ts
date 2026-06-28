export function createUniqueRowKeyFactory(getKey) {
  const usedRowKeys = new Map();
  return (row, index) => {
    const raw = getKey ? getKey(row, index) : index;
    const base = raw == null || raw === '' ? `row-${index}` : String(raw);
    const seen = usedRowKeys.get(base) || 0;
    usedRowKeys.set(base, seen + 1);
    return seen === 0 ? base : `${base}#${seen}`;
  };
}

export function buildTableRowKey(row = {}, index = 0, tab = 'row') {
  if (row?.id) return `rule-${row.id}`;
  if (row?.sessionId || row?.session_id) return buildSessionKey(row);
  const parts = [
    tab,
    row?.project,
    row?.projectAlias,
    row?.taskType,
    row?.outputStatus,
    row?.workPurpose,
    row?.workStage,
    row?.valueLevel,
    row?.source,
    row?.model,
    row?.device,
    row?.collectedAt,
    row?.date,
    row?.day,
    row?.pattern,
    row?.message
  ].map(value => String(value || '').trim()).filter(Boolean);
  return parts.length ? parts.join('::') : `${tab || 'row'}-${index}`;
}

export function buildSessionKey(session = {}) {
  const sessionId = session.sessionId || session.session_id || session.id || session.projectPath || session.projectAlias || '';
  return [
    session.device || 'unknown-device',
    session.source || 'unknown-source',
    sessionId || 'unknown-session'
  ].join('::');
}
