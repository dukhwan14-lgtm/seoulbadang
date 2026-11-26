const express = require('express');
const { Pool } = require('pg');
const crypto = require('node:crypto');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { shiftConflict, weeklyConflict, weekStart } = require('./payroll-guard');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { STAFF_PIN, ADMIN_PIN, SESSION_SECRET } = process.env;
if (!process.env.DATABASE_URL || !/^\d{4}$/.test(STAFF_PIN || '') || !/^\d{4}$/.test(ADMIN_PIN || '') || STAFF_PIN === ADMIN_PIN || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw Error('Check environment variables');
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { scriptSrc: ["'self'", "'unsafe-inline'"], scriptSrcAttr: ["'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return res.sendStatus(415);
  next();
});

const sign = s => crypto.createHmac('sha256', SESSION_SECRET).update(s).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.post('/api/login', rateLimit({ windowMs: 900000, limit: 10 }), (req, res) => {
  const p = req.body.pin;
  const role = equal(p, ADMIN_PIN) ? '관리자' : equal(p, STAFF_PIN) ? '직원' : null;
  if (!role) return res.status(401).json({ error: 'PIN을 확인하세요' });
  const s = Buffer.from(JSON.stringify({ role, exp: Date.now() + 43200000 })).toString('base64url');
  res.cookie('session', s + '.' + sign(s), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 43200000 });
  res.json({ role });
});

app.use('/api', (req, res, next) => {
  try {
    const [s, h] = (req.headers.cookie || '').match(/(?:^|; )session=([^;]+)/)[1].split('.');
    if (!equal(h, sign(s))) throw Error();
    const v = JSON.parse(Buffer.from(s, 'base64url'));
    if (v.exp < Date.now()) throw Error();
    req.role = v.role;
    next();
  } catch {
    res.status(401).json({ error: '다시 로그인하세요' });
  }
});

app.get('/api/session', (req, res) => res.json({ role: req.role }));
app.post('/api/logout', (req, res) => { res.clearCookie('session'); res.json({ ok: true }); });

const stores = ['뚝섬점', '혜화점'];
const tabs = ['order', 'resv', 'stock', 'shift', 'closing', 'schedule', 'payroll'];
const adminOnly = (req, res, next) => req.role === '관리자' ? next() : res.sendStatus(403);

function scope(req, res, next) {
  const { store, day, tab } = req.query;
  if (!stores.includes(store) || !tabs.includes(tab) || !/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
    return res.status(400).json({ error: '매장 또는 날짜 오류' });
  }
  req.scope = [store, day, tab];
  if (tab === 'payroll' && req.role !== '관리자') return res.sendStatus(403);
  if (req.method !== 'GET' && ['shift', 'schedule'].includes(tab) && req.role !== '관리자') return res.sendStatus(403);
  next();
}

function validateExtra(tab, r) {
  const str = (v) => { if (typeof v !== 'string' || v.length > 500) throw Error('문자 입력 오류'); return v; };
  const num = (v, optional = false) => { if (optional && v === '') return ''; if (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v) || !Number.isFinite(+v) || +v > 1e12) throw Error('숫자 입력 오류'); return v; };
  const arr = (v, f) => { if (!Array.isArray(v) || v.length > 200) throw Error('목록 오류'); return v.map(f); };
  if (tab === 'schedule') {
    const status = str(r.status);
    if (!['출근', '확정 휴무', '희망 휴무', '기본 미근무', '매장 휴무'].includes(status)) throw Error('근무 상태 오류');
    const name = str(r.name).trim();
    if (!name) throw Error('직원명 필요');
    const actual = str(r.actual);
    if (!stores.includes(actual)) throw Error('근무 매장 오류');
    const start = str(r.start), end = str(r.end);
    if (status === '출근' && ![start, end].every(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x))) throw Error('근무시간 오류');
    return { name, status, actual, start, end, note: str(r.note) };
  }
  const out = {};
  for (const k of ['cash', 'transfer', 'card', 'float', 'high', 'low', 'tables', 'popularQty']) out[k] = num(r[k], true);
  for (const k of ['popular', 'note']) out[k] = str(r[k]);
  const item = x => ({ name: str(x.name), qty: num(x.qty, true), unit: str(x.unit), amount: num(x.amount, true) });
  out.expenses = arr(r.expenses, x => ({ vendor: str(x.vendor), method: str(x.method), amount: num(x.amount), items: arr(x.items, item) }));
  out.memos = arr(r.memos, x => ({ ...item(x), type: str(x.type) }));
  return out;
}

// 연도별 법정 최저임금 (payroll_settings)
async function getMinWages() {
  const q = await pool.query('SELECT year, min_wage FROM payroll_settings');
  const map = {};
  for (const row of q.rows) map[row.year] = row.min_wage;
  return map;
}

async function validatePayroll(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('입력 오류');
  const str = (v, label, max = 500) => { if (typeof v !== 'string' || v.length > max) throw Error(label + ' 입력 오류'); return v; };
  const dig = (v, label) => { if (typeof v !== 'string' || !/^\d{1,12}$/.test(v) || +v > 100000000) throw Error(label + ' 숫자 확인'); return v; };
  const flag = (v, label) => { if (!['yes', 'no'].includes(v)) throw Error(label + ' 확인'); return v; };
  const out = {};
  for (const k of ['name', 'note']) out[k] = str(r[k], '항목');
  out.day = str(r.day, '날짜');
  for (const k of ['start', 'end']) out[k] = str(r[k], '시간');
  for (const k of ['rest', 'rate', 'ordinary', 'nightMinutes', 'overtimeMinutes', 'holidayMinutes', 'weeklyMinutes', 'night', 'overtime', 'holiday', 'weekly']) out[k] = dig(r[k], '수당·시간');
  if (!out.name.trim()) throw Error('직원명을 입력하세요');
  if (!['small', 'large', 'unknown'].includes(r.size)) throw Error('사업장 규모 확인');
  out.size = r.size;
  out.review = flag(r.review, '검토 여부');
  out.paid = flag(r.paid, '지급 여부');
  out.confirmed = flag(r.confirmed, '확정 여부');
  out.nightRateMode = r.nightRateMode === 'rate' ? 'rate' : 'amount';
  out.nightRate = r.nightRate === undefined || r.nightRate === '' ? '0' : dig(r.nightRate, '야간 시급');

  const items = r.otherItems === undefined ? [] : r.otherItems;
  if (!Array.isArray(items) || items.length > 50) throw Error('기타 수당 목록 오류');
  out.otherItems = items.map(x => {
    if (!x || typeof x !== 'object') throw Error('기타 수당 항목 오류');
    const title = str(x.title === undefined ? '' : x.title, '기타 수당 항목명', 50).trim();
    const amount = x.amount === undefined || x.amount === '' ? '0' : dig(String(x.amount), '기타 수당 금액');
    if (!title && amount === '0') return null;
    if (!title) throw Error('기타 수당 항목명을 입력하세요');
    return { title, amount };
  }).filter(Boolean);

  const result = require('./public/payroll-core')(out, { minWages: await getMinWages() });
  if (out.confirmed === 'yes' && (result.red.length || result.yellow.length)) throw Error('미확인 또는 미달 항목이 있어 정산을 확정할 수 없습니다');
  return out;
}

async function validate(tab, r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('입력 오류');
  if (tab === 'payroll') return validatePayroll(r);
  if (tab === 'closing' || tab === 'schedule') return validateExtra(tab, r);
  const out = {};
  const keys = {
    order: ['name', 'vendor', 'kg', 'qty', 'unit', 'total', 'photo'],
    resv: ['name', 'time', 'people', 'note', 'state'],
    stock: ['name', 'vendor', 'qty', 'target', 'unit', 'note', 'photo'],
    shift: ['name', 'start', 'end', 'note']
  }[tab];
  for (const k of keys) {
    if (r[k] == null) continue;
    if (typeof r[k] !== 'string' || r[k].length > (k === 'photo' ? 1500000 : 500)) throw Error('입력 길이 오류');
    out[k] = r[k];
  }
  const num = k => out[k] !== undefined && out[k] !== '' && Number.isFinite(+out[k]) && +out[k] >= 0;
  const time = k => /^([01]\d|2[0-3]):[0-5]\d$/.test(out[k] || '');
  if (!out.name?.trim()) throw Error('이름을 입력하세요');
  if (tab === 'order' && (!(num('total') && +out.total > 0) || !((num('kg') && +out.kg > 0) || (num('qty') && +out.qty > 0)) || ['kg', 'qty'].some(k => out[k] && !num(k)))) throw Error('입고 수량 및 금액 오류');
  if (tab === 'resv' && (!time('time') || !num('people') || !Number.isInteger(+out.people) || +out.people < 1 || !['확정', '대기', '취소'].includes(out.state))) throw Error('예약 정보 오류');
  if (tab === 'stock' && (!num('qty') || !num('target'))) throw Error('재고 수량 오류');
  if (tab === 'shift' && (!time('start') || !time('end'))) throw Error('근무시간 오류');
  if (out.photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(out.photo)) throw Error('사진 형식 오류');
  return out;
}

// 같은 매장·직원의 동일 근무와 같은 주(월~일) 주휴수당 중복 차단
async function assertPayrollUnique(store, day, data, excludeId) {
  const near = await pool.query(
    "SELECT id,store,day::text,data FROM records WHERE tab='payroll' AND store=$1 AND data->>'name'=$2 AND day BETWEEN $3::date - 1 AND $3::date + 1",
    [store, data.name, day]
  );
  const dup = shiftConflict(near.rows, { store, day, start: data.start, end: data.end, name: data.name }, excludeId);
  if (dup) throw Error(`동일 근무가 이미 등록되어 있습니다 (${dup.day} ${dup.start}~${dup.end} ${dup.name})`);
  if (+data.weekly > 0 || +data.weeklyMinutes > 0) {
    const ws = weekStart(day);
    const week = await pool.query(
      "SELECT id,store,day::text,data FROM records WHERE tab='payroll' AND data->>'name'=$1 AND day >= $2::date AND day < $2::date + 7",
      [data.name, ws]
    );
    const wdup = weeklyConflict(week.rows, excludeId);
    if (wdup) throw Error(`같은 주(${ws} 기준 월~일)에 ${data.name}의 주휴수당이 이미 등록되어 있습니다 (${wdup.day})`);
  }
}

app.get('/api/range', async (req, res) => {
  const { month, tab } = req.query;
  if (tab === 'payroll' && req.role !== '관리자') return res.sendStatus(403);
  if (!['closing', 'schedule', 'shift', 'payroll'].includes(tab) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return res.sendStatus(400);
  const q = await pool.query("SELECT id,store,day::text,tab,data,version FROM records WHERE tab=$1 AND day >= $2::date AND day < ($2::date + interval '1 month') ORDER BY day,id", [tab, month + '-01']);
  res.json(q.rows.map(x => ({ ...x.data, id: x.id, store: x.store, day: x.day, version: x.version })));
});

app.get('/api/records', scope, async (req, res) => {
  const q = await pool.query('SELECT id,data,version FROM records WHERE store=$1 AND day=$2 AND tab=$3 ORDER BY id', req.scope);
  res.json(q.rows.map(x => ({ ...x.data, id: x.id, version: x.version })));
});

app.post('/api/records', scope, async (req, res) => {
  let data;
  try { data = await validate(req.scope[2], { ...req.body, day: req.scope[1] }); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (req.scope[2] === 'payroll') {
    try { await assertPayrollUnique(req.scope[0], req.scope[1], data, null); } catch (e) { return res.status(409).json({ error: e.message }); }
  }
  await pool.query('INSERT INTO records(store,day,tab,data) VALUES($1,$2,$3,$4)', [...req.scope, data]);
  res.json({ ok: true });
});

app.put('/api/records/:id', scope, async (req, res) => {
  let data;
  try { data = await validate(req.scope[2], { ...req.body, day: req.scope[1] }); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (req.scope[2] === 'payroll') {
    try { await assertPayrollUnique(req.scope[0], req.scope[1], data, req.params.id); } catch (e) { return res.status(409).json({ error: e.message }); }
  }
  const q = await pool.query('UPDATE records SET data=$5,version=version+1 WHERE store=$1 AND day=$2 AND tab=$3 AND id=$4 AND version=$6', [...req.scope, req.params.id, data, req.body.version]);
  if (!q.rowCount) return res.status(409).json({ error: '다른 직원이 변경했습니다. 새로고침하세요' });
  res.json({ ok: true });
});

app.delete('/api/records/:id', scope, async (req, res) => {
  const q = await pool.query('DELETE FROM records WHERE store=$1 AND day=$2 AND tab=$3 AND id=$4 AND version=$5', [...req.scope, req.params.id, req.body.version]);
  if (!q.rowCount) return res.status(409).json({ error: '이미 변경된 기록입니다' });
  res.json({ ok: true });
});

app.get('/api/backup', adminOnly, async (req, res) => {
  const q = await pool.query('SELECT store,day::text,tab,data FROM records ORDER BY id');
  res.json(q.rows);
});

// 연도별 법정 최저임금 관리자 설정
app.get('/api/min-wages', adminOnly, async (req, res) => res.json(await getMinWages()));
app.put('/api/min-wages', adminOnly, async (req, res) => {
  const year = String(req.body.year == null ? '' : req.body.year);
  const wage = req.body.minWage;
  if (!/^(19|20)\d{2}$/.test(year) || !Number.isSafeInteger(wage) || wage < 1000 || wage > 1000000) return res.status(400).json({ error: '연도 또는 최저임금을 확인하세요' });
  await pool.query('INSERT INTO payroll_settings(year,min_wage) VALUES($1,$2) ON CONFLICT(year) DO UPDATE SET min_wage=EXCLUDED.min_wage', [year, wage]);
  res.json({ ok: true, year, minWage: wage });
});
app.delete('/api/min-wages', adminOnly, async (req, res) => {
  const year = String(req.body.year == null ? '' : req.body.year);
  if (!/^(19|20)\d{2}$/.test(year)) return res.status(400).json({ error: '연도를 확인하세요' });
  const q = await pool.query('DELETE FROM payroll_settings WHERE year=$1', [year]);
  res.json({ ok: true, deleted: q.rowCount });
});

const { rule, generate } = require('./schedule-rules');
app.get('/api/schedule-rules', adminOnly, async (req, res) => {
  const q = await pool.query('SELECT data FROM schedule_rules ORDER BY name');
  res.json(q.rows.map(x => x.data));
});
app.put('/api/schedule-rules', adminOnly, async (req, res) => {
  let r;
  try { r = rule(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  await pool.query('INSERT INTO schedule_rules(name,data) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET data=EXCLUDED.data', [r.name, r]);
  res.json({ ok: true });
});
app.delete('/api/schedule-rules', adminOnly, async (req, res) => {
  await pool.query('DELETE FROM schedule_rules WHERE name=$1', [req.body.name]);
  res.json({ ok: true });
});
app.post('/api/schedule-generate', adminOnly, async (req, res) => {
  const month = req.body.month;
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '월 선택 오류' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('LOCK TABLE records IN SHARE ROW EXCLUSIVE MODE');
    const rules = (await c.query('SELECT data FROM schedule_rules ORDER BY name')).rows.map(x => x.data);
    const existing = (await c.query("SELECT day::text,data->>'name' AS name FROM records WHERE tab IN ('schedule','shift') AND day >= $1::date AND day < $1::date + interval '1 month'", [month + '-01'])).rows.filter(x => x.name);
    const rows = generate(month, rules, existing);
    if (!req.body.preview) for (const r of rows) await c.query("INSERT INTO records(store,day,tab,data) VALUES($1,$2,'schedule',$3)", [r.store, r.day, r.data]);
    await c.query('COMMIT');
    res.json({ count: rows.length });
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
});

app.use(express.static('public'));
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: '서버 오류' });
});

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS records(id BIGSERIAL PRIMARY KEY,store TEXT NOT NULL,day DATE NOT NULL,tab TEXT NOT NULL,data JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS schedule_rules(name TEXT PRIMARY KEY,data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS payroll_settings(year TEXT PRIMARY KEY,min_wage INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS records_scope ON records(store,day,tab);
    INSERT INTO payroll_settings(year,min_wage) SELECT year,min_wage FROM (VALUES ('2025',10030),('2026',10320)) AS v(year,min_wage) WHERE NOT EXISTS (SELECT 1 FROM payroll_settings);
  `);
  app.listen(process.env.PORT || 3000);
})().catch(e => { console.error(e.message); process.exit(1); });
