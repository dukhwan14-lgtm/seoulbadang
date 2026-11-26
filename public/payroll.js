// 시급제 근무 정산 (관리자 전용) - 서울바당 운영노트 V2.5
let payRows = [];
let payWages = null;
let payCurrent = null;

const payFields = [
  ['name', '직원명', 'text'],
  ['start', '출근', 'time'],
  ['end', '퇴근 (자정 이후는 다음날)', 'time'],
  ['rest', '무급 휴게 (분)', 'number'],
  ['rate', '기본 시급 (원/시간)', 'number'],
  ['ordinary', '통상시급 (원/시간)', 'number'],
  ['size', '상시근로자 규모', 'select', [['unknown', '확인 필요 (미확인)'], ['small', '5인 미만'], ['large', '5인 이상']]],
  ['review', '주간·휴일·계약 조건 검토', 'select', [['no', '미검토'], ['yes', '검토 완료']]],
  ['nightMinutes', '실제 야간근로 (분)', 'number'],
  ['overtimeMinutes', '법정 가산 대상 연장근로 (분)', 'number'],
  ['holidayMinutes', '법정 가산 대상 휴일근로 (분)', 'number'],
  ['weeklyMinutes', '주휴 유급시간 (분)', 'number'],
  ['nightRateMode', '야간 수당 입력 방식', 'select', [['amount', '야간 추가 수당 직접 입력 (원)'], ['rate', '야간 시급 직접 입력 (원/시간)']]],
  ['nightRate', '야간 시급 (원/시간)', 'number'],
  ['night', '야간 추가 수당 (원)', 'number'],
  ['overtime', '연장 추가 수당 (원)', 'number'],
  ['holiday', '휴일 추가 수당 (원)', 'number'],
  ['weekly', '주휴수당 (원)', 'number'],
  ['paid', '지급 상태', 'select', [['no', '미지급'], ['yes', '지급 완료']]],
  ['confirmed', '정산 확정', 'select', [['no', '미확정'], ['yes', '확정']]],
  ['note', '수당 근거 및 기타 지급 사유', 'text']
];

const payDefaults = {
  name: '', start: '18:00', end: '02:00', rest: '30', rate: '13000', ordinary: '13000',
  size: 'unknown', review: 'no', nightMinutes: '0', overtimeMinutes: '0', holidayMinutes: '0',
  weeklyMinutes: '0', nightRateMode: 'amount', nightRate: '0', night: '0', overtime: '0',
  holiday: '0', weekly: '0', paid: 'no', confirmed: 'no', note: ''
};

function payHM(t) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || ''));
  return m ? +m[1] * 60 + +m[2] : NaN;
}
function paySpan(day, start, end) {
  const base = Date.parse(day + 'T00:00:00Z') / 60000;
  const a = base + payHM(start);
  let b = base + payHM(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b <= a) b += 1440;
  return [a, b];
}
function payWeekStart(day) {
  const t = new Date(day + 'T00:00:00Z');
  const w = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - w);
  return t.toISOString().slice(0, 10);
}

function payFieldHTML([k, label, type, opts], v) {
  const id = 'p_' + k;
  if (type === 'select') {
    return `<label for="${id}">${label}</label><select id="${id}" name="${k}">` +
      opts.map(([val, text]) => `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(text)}</option>`).join('') +
      '</select>';
  }
  return `<label for="${id}">${label}</label><input id="${id}" name="${k}" type="${type}" ${type === 'number' ? 'inputmode="numeric" min="0" step="1"' : ''} value="${esc(v)}">`;
}

function payDrawEditor(r) {
  const ed = $('payEditor');
  const src = r || payDefaults;
  ed.innerHTML = (payCurrent ? `<small>수정 중: ${esc(payCurrent.store || $('store').value)} ${esc(payCurrent.day)} ${esc(payCurrent.name)}</small>` : '') +
    payFields.map(f => payFieldHTML(f, src[f[0]] ?? payDefaults[f[0]] ?? '')).join('') +
    '<h3>기타 수당</h3><div id="otherItems"></div><button type="button" class="secondary" id="addOther">+ 기타 수당 항목 추가</button>';
  for (const it of (src.otherItems || [])) payAddOtherRow(it);
  if (!(src.otherItems || []).length) payAddOtherRow();
  $('addOther').onclick = () => { payAddOtherRow(); dirty = true; payCalc(); };
  ed.oninput = ed.onchange = () => { dirty = true; payNightMode(); payCalc(); };
  payNightMode();
  payCalc();
}

function payAddOtherRow(it = {}) {
  const row = document.createElement('div');
  row.className = 'row other-item';
  row.innerHTML = `<input name="otherTitle" placeholder="항목명 (예: 식대)" value="${esc(it.title || '')}" style="flex:2">` +
    `<input name="otherAmount" type="number" inputmode="numeric" min="0" step="1" placeholder="금액(원)" value="${esc(it.amount === 0 ? '0' : it.amount || '')}" style="flex:1">` +
    '<button type="button" class="secondary" style="width:auto;min-width:52px">삭제</button>';
  row.querySelector('button').onclick = () => { row.remove(); dirty = true; payCalc(); };
  $('otherItems').append(row);
}

function payNightMode() {
  const ed = $('payEditor');
  if (!ed) return;
  const mode = ed.querySelector('[name=nightRateMode]').value;
  const night = ed.querySelector('[name=night]');
  const nightRate = ed.querySelector('[name=nightRate]');
  const rate = +ed.querySelector('[name=rate]').value || 0;
  const mins = +ed.querySelector('[name=nightMinutes]').value || 0;
  if (mode === 'rate') {
    const auto = Math.max(0, Math.round((( +nightRate.value || 0) - rate) * mins / 60));
    night.value = String(auto);
    night.readOnly = true;
    night.style.background = '#f2f4f6';
  } else {
    night.readOnly = false;
    night.style.background = '#fff';
  }
}

function payData() {
  const ed = $('payEditor');
  const r = {};
  for (const [k] of payFields) r[k] = ed.querySelector(`[name=${k}]`).value;
  r.day = payCurrent?.day || $('day').value;
  r.otherItems = [...ed.querySelectorAll('.other-item')].map(x => ({
    title: x.querySelector('[name=otherTitle]').value,
    amount: x.querySelector('[name=otherAmount]').value === '' ? '0' : x.querySelector('[name=otherAmount]').value
  })).filter(x => String(x.title).trim() || +x.amount > 0);
  return r;
}

function payCalc() {
  const out = $('payResult');
  if (!out) return null;
  const r = payData();
  let x;
  try {
    x = payrollCalculate(r, { minWages: payWages || {} });
  } catch (e) {
    out.textContent = e.message;
    return null;
  }
  const breakdown = x.items.map(i => `${i.label} ${i.minutes}분 · 입력 ${money(i.amount)}${i.required ? ' · 법정 기준 ' + money(i.required) : ''}`).join(' · ');
  out.innerHTML = `<p>유급 ${x.work}분 · 기본급 ${money(x.base)} · 수당 ${money(x.extra)} · 합계 <b>${money(x.total)}</b></p>` +
    `<div class="muted">${esc(breakdown)}${x.otherTotal ? ' · 기타 ' + money(x.otherTotal) : ''}</div>` +
    x.red.map(t => `<p class="red">⛔ ${esc(t)}</p>`).join('') +
    x.yellow.map(t => `<p class="warn">⚠️ ${esc(t)}</p>`).join('') +
    (!x.red.length && !x.yellow.length ? '<p class="ok">입력 기준 검증 완료</p>' : '');
  const rateInput = $('payEditor').querySelector('[name=rate]');
  rateInput.style.borderColor = x.min && +r.rate < x.min ? '#d92d45' : '';
  return x;
}

function payDuplicate(r) {
  const mine = payCurrent?.id;
  const store = payCurrent?.store || $('store').value;
  const target = paySpan(r.day, r.start, r.end);
  if (target) {
    for (const o of payRows) {
      if (mine != null && o.id === mine) continue;
      if (o.store !== store || o.name !== r.name) continue;
      const other = paySpan(o.day, o.start, o.end);
      if (other && target[0] < other[1] && other[0] < target[1]) {
        return `같은 매장·직원의 겹치는 근무가 이미 등록되어 있습니다 (${o.day} ${o.start}~${o.end})`;
      }
    }
  }
  if (+r.weekly > 0 || +r.weeklyMinutes > 0) {
    const ws = payWeekStart(r.day);
    for (const o of payRows) {
      if (mine != null && o.id === mine) continue;
      if (o.name !== r.name || payWeekStart(o.day) !== ws) continue;
      if (+o.weekly > 0 || +o.weeklyMinutes > 0) {
        return `같은 주(${ws} 기준 월~일)에 ${r.name}의 주휴수당이 이미 등록되어 있습니다 (${o.day} ${o.store})`;
      }
    }
  }
  return '';
}

async function paySave() {
  if (busy || extraBusy) return;
  if (tab === 'shift' && $('form').querySelector('[name=name]')?.value) return alert('개별 근무표 입력을 먼저 저장하세요');
  const r = payData();
  let x;
  try { x = payrollCalculate(r, { minWages: payWages || {} }); } catch (e) { return alert(e.message); }
  if (r.confirmed === 'yes' && (x.red.length || x.yellow.length)) {
    return alert('관리자 확인이 필요하거나 법정 기준 미달인 항목이 있어 정산을 확정할 수 없습니다.\n- ' + [...x.red, ...x.yellow].join('\n- '));
  }
  const dup = payDuplicate(r);
  if (dup) return alert(dup);
  extraBusy = true;
  try {
    const q = new URLSearchParams({ store: payCurrent?.store || $('store').value, day: r.day, tab: 'payroll' });
    await api('records' + (payCurrent ? '/' + payCurrent.id : '') + '?' + q, payCurrent ? 'PUT' : 'POST', { ...r, version: payCurrent?.version });
    payCurrent = null;
    await render();
  } catch (e) {
    alert(e.message);
  } finally {
    extraBusy = false;
  }
}

function payDrawWages() {
  const w = payWages || {};
  const box = $('minWagePanel');
  if (!box) return;
  const years = Object.keys(w).sort();
  box.innerHTML = '<h3>연도별 법정 최저임금</h3><small>등록되지 않은 연도는 정산 시 “관리자 확인 필요”로 표시되고 확정이 차단됩니다.</small><div id="minWageList"></div>' +
    '<div class="row" style="margin-top:8px"><input id="mwYear" inputmode="numeric" placeholder="연도 (예: 2027)" style="flex:1">' +
    '<input id="mwWage" inputmode="numeric" placeholder="최저임금 (원/시간)" style="flex:1"></div>' +
    '<button type="button" class="secondary" id="mwAdd">연도별 최저임금 추가·수정</button>';
  const list = $('minWageList');
  for (const y of years) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span style="min-width:56px">${esc(y)}년</span><input type="number" inputmode="numeric" min="0" step="1" value="${esc(w[y])}" style="flex:1">` +
      '<button type="button" class="secondary" style="width:auto">저장</button><button type="button" class="secondary" style="width:auto">삭제</button>';
    const input = row.querySelector('input');
    const [saveBtn, delBtn] = row.querySelectorAll('button');
    saveBtn.onclick = () => paySaveWage(y, input.value);
    delBtn.onclick = () => payDeleteWage(y);
    list.append(row);
  }
  if (!years.length) list.textContent = '등록된 연도별 최저임금이 없습니다.';
  $('mwAdd').onclick = () => paySaveWage($('mwYear').value.trim(), $('mwWage').value);
}

async function paySaveWage(year, wage) {
  if (extraBusy) return;
  if (!/^(19|20)\d{2}$/.test(String(year || ''))) return alert('연도를 4자리로 입력하세요');
  if (!/^\d{1,7}$/.test(String(wage || ''))) return alert('최저임금을 숫자로 입력하세요');
  extraBusy = true;
  try {
    await api('min-wages', 'PUT', { year: String(year), minWage: +wage });
    payWages = await api('min-wages');
    payDrawWages();
    payCalc();
    payList();
  } catch (e) {
    alert(e.message);
  } finally {
    extraBusy = false;
  }
}

async function payDeleteWage(year) {
  if (extraBusy) return;
  if (!confirm(`${year}년 최저임금 기준을 삭제할까요? 해당 연도 정산은 “관리자 확인 필요”로 표시됩니다.`)) return;
  extraBusy = true;
  try {
    await api('min-wages', 'DELETE', { year: String(year) });
    payWages = await api('min-wages');
    payDrawWages();
    payCalc();
    payList();
  } catch (e) {
    alert(e.message);
  } finally {
    extraBusy = false;
  }
}

function payList() {
  const box = $('payList');
  if (!box) return;
  box.innerHTML = '';
  const totals = {}, byStore = {};
  let grand = 0, unpaidAll = 0;
  for (const r of payRows) {
    let x;
    try { x = payrollCalculate(r, { minWages: payWages || {} }); } catch (e) { x = { work: 0, total: 0, red: [e.message], yellow: [] }; }
    const key = r.store + ' · ' + r.name;
    const t = totals[key] ?? (totals[key] = { work: 0, total: 0, unpaid: 0 });
    t.work += x.work; t.total += x.total; if (r.paid !== 'yes') t.unpaid += x.total;
    const s = byStore[r.store] ?? (byStore[r.store] = { total: 0, unpaid: 0 });
    s.total += x.total; if (r.paid !== 'yes') s.unpaid += x.total;
    grand += x.total; if (r.paid !== 'yes') unpaidAll += x.total;

    const line = document.createElement('div');
    line.className = 'item';
    const info = document.createElement('div');
    const warn = x.red.length || x.yellow.length;
    info.innerHTML = `<b>${esc(r.name)}</b> ${esc(r.day)} ` +
      `<span class="pill ${r.paid === 'yes' ? 'ok' : 'low'}">${r.paid === 'yes' ? '지급' : '미지급'}</span>` +
      `${r.confirmed === 'yes' ? ' <span class="pill ok">확정</span>' : ''}` +
      `<br><span class="muted">${esc(r.store)} · ${esc(r.start)}~${esc(r.end)} · 휴게 ${esc(r.rest)}분 · 유급 ${x.work}분 · ${money(x.total)}</span>` +
      (warn ? `<br><span class="${x.red.length ? 'red' : 'warn'}">${esc(x.red[0] || x.yellow[0])}${(x.red.length + x.yellow.length) > 1 ? ` 외 ${x.red.length + x.yellow.length - 1}건` : ''}</span>` : '');
    const actions = document.createElement('div');
    actions.className = 'actions';
    const edit = document.createElement('button');
    edit.className = 'secondary'; edit.textContent = '수정';
    edit.onclick = () => {
      if (!canLeave()) return;
      payCurrent = r;
      payDrawEditor(r);
      dirty = true;
      $('payrollPanel').scrollIntoView({ block: 'start' });
    };
    const pay = document.createElement('button');
    pay.className = 'secondary'; pay.textContent = r.paid === 'yes' ? '미지급으로' : '지급 완료';
    pay.onclick = async () => {
      if (extraBusy || busy) return;
      extraBusy = true;
      try {
        const q = new URLSearchParams({ store: r.store, day: r.day, tab: 'payroll' });
        await api('records/' + r.id + '?' + q, 'PUT', { ...r, paid: r.paid === 'yes' ? 'no' : 'yes', version: r.version });
        payCurrent = null;
        await render();
      } catch (e) { alert(e.message); } finally { extraBusy = false; }
    };
    const del = document.createElement('button');
    del.className = 'secondary'; del.textContent = '삭제';
    del.onclick = async () => {
      if (extraBusy || busy) return;
      if (!confirm('정산 기록을 삭제할까요?')) return;
      extraBusy = true;
      try {
        const q = new URLSearchParams({ store: r.store, day: r.day, tab: 'payroll' });
        await api('records/' + r.id + '?' + q, 'DELETE', { version: r.version });
        payCurrent = null;
        await render();
      } catch (e) { alert(e.message); } finally { extraBusy = false; }
    };
    actions.append(edit, pay, del);
    line.append(info, actions);
    box.append(line);
  }
  if (!payRows.length) {
    const empty = document.createElement('small');
    empty.textContent = '이번 달 정산 기록이 없습니다.';
    box.append(empty);
  }
  const summary = document.createElement('div');
  summary.innerHTML = '<h3>월간 집계</h3>' +
    Object.keys(totals).sort().map(k => `<div class="muted">${esc(k)}: ${totals[k].work}분 · ${money(totals[k].total)} · 미지급 ${money(totals[k].unpaid)}</div>`).join('') +
    Object.keys(byStore).sort().map(k => `<div class="muted">[매장] ${esc(k)}: ${money(byStore[k].total)} · 미지급 ${money(byStore[k].unpaid)}</div>`).join('') +
    `<div><b>전체 ${money(grand)} · 미지급 ${money(unpaidAll)}</b></div>`;
  box.prepend(summary);
}

async function renderPayroll(n) {
  const panel = $('payrollPanel');
  const day = $('day').value;
  const store = $('store').value;
  const rows = await api('range?tab=payroll&month=' + day.slice(0, 7));
  if (n !== seq) return;
  try { payWages = await api('min-wages'); } catch (e) { payWages = {}; }
  if (n !== seq) return;
  payRows = rows;
  panel.hidden = false;
  panel.innerHTML = '<h2>시급제 근무 정산 <span class="muted">관리자 전용</span></h2>' +
    '<small>수당은 직접 입력하거나 야간 시급으로 자동 계산할 수 있습니다. 검증은 입력된 적용 시간 기준이며 법적 적합성을 보증하지 않습니다. 주휴수당은 직원별 주 1회만 등록하세요.</small>' +
    '<div id="minWagePanel"></div><h3>근무·수당 입력</h3><div id="payEditor"></div><div id="payResult" aria-live="polite"></div>' +
    '<div class="row"><button id="paySave">근무 정산 저장</button><button class="secondary" id="payReset">신규 입력</button></div>' +
    '<h3>월간 정산 (전체 매장)</h3><div id="payList"></div>';
  payDrawWages();
  payDrawEditor(payCurrent || payDefaults);
  $('paySave').onclick = paySave;
  $('payReset').onclick = () => {
    if (!canLeave()) return;
    payCurrent = null;
    payDrawEditor(payDefaults);
    dirty = false;
  };
  payList();
}
