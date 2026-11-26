// 급여 기록의 동일 근무·주휴수당 중복 판정 (DB 조회는 server.js가 담당)
function hm(t) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t == null ? '' : t));
  return m ? +m[1] * 60 + +m[2] : NaN;
}

// 하루를 분 단위 절대 시각으로: 자정을 넘는 근무는 1440분을 더해 이어 붙인다.
function span(day, start, end) {
  const base = Date.parse(day + 'T00:00:00Z') / 60000;
  const a = base + hm(start);
  let b = base + hm(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b <= a) b += 1440;
  return [a, b];
}

function weekStart(day) {
  const t = new Date(day + 'T00:00:00Z');
  const w = (t.getUTCDay() + 6) % 7; // 월요일 기준
  t.setUTCDate(t.getUTCDate() - w);
  return t.toISOString().slice(0, 10);
}

function sameRecord(a, b) {
  return a != null && b != null && String(a) === String(b);
}

// rows: [{id, store, day, data}] 같은 매장·직원의 앞뒤 하루 범위 기록
function shiftConflict(rows, target, excludeId) {
  const targetSpan = span(target.day, target.start, target.end);
  if (!targetSpan) return null;
  for (const row of rows) {
    if (sameRecord(row.id, excludeId)) continue;
    if (row.store !== target.store) continue;
    if ((row.data && row.data.name) !== target.name) continue;
    const other = span(row.day, row.data.start, row.data.end);
    if (!other) continue;
    if (targetSpan[0] < other[1] && other[0] < targetSpan[1]) {
      return { id: row.id, day: row.day, start: row.data.start, end: row.data.end, name: row.data.name };
    }
  }
  return null;
}

// rows: [{id, store, day, data}] 같은 직원의 같은 주(월~일) 기록
function weeklyConflict(rows, excludeId) {
  for (const row of rows) {
    if (sameRecord(row.id, excludeId)) continue;
    const d = row.data || {};
    if (+d.weekly > 0 || +d.weeklyMinutes > 0) {
      return { id: row.id, day: row.day, store: row.store, name: d.name };
    }
  }
  return null;
}

module.exports = { shiftConflict, weeklyConflict, weekStart, span };
