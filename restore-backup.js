// Offline migration only. Target must have initialized schema and no operational data.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const [file, flag] = process.argv.slice(2);
const obj = x => x && typeof x === 'object' && !Array.isArray(x);
function validate(b) {
  assert(b.format === 'seoulbadang-full-v1');
  for (const k of ['records','scheduleRules','payrollSettings']) assert(Array.isArray(b[k]));
  const unique = (rows,key) => assert.equal(new Set(rows.map(key)).size,rows.length,'Duplicate key');
  for(const r of b.records){
    assert(/^[1-9]\d*$/.test(String(r.id)) && BigInt(r.id)<9223372036854775807n);
    assert(typeof r.id==='string' || Number.isSafeInteger(r.id));
    assert(['뚝섬점','혜화점'].includes(r.store));
    assert(['order','resv','stock','shift','closing','schedule','payroll'].includes(r.tab));
    assert(/^\d{4}-\d{2}-\d{2}$/.test(r.day) && new Date(r.day).toISOString().slice(0,10)===r.day);
    assert(obj(r.data) && Number.isInteger(r.version) && r.version>0 && r.version<=2147483647);
  }
  for(const r of b.scheduleRules) assert(typeof r.name==='string' && r.name.trim() && obj(r.data));
  for(const r of b.payrollSettings) assert(typeof r.year==='string' && /^(19|20)\d{2}$/.test(r.year) && Number.isInteger(r.min_wage) && r.min_wage>=1000 && r.min_wage<=1000000);
  unique(b.records,r=>String(r.id)); unique(b.scheduleRules,r=>r.name); unique(b.payrollSettings,r=>r.year);
  if(b.staffAccounts!==undefined || b.leaveRequests!==undefined){assert(Array.isArray(b.staffAccounts)&&Array.isArray(b.leaveRequests));unique(b.staffAccounts,r=>r.username);unique(b.staffAccounts,r=>r.name);unique(b.leaveRequests,r=>String(r.id));for(const r of b.staffAccounts)assert(/^[a-z0-9_-]{3,32}$/.test(r.username)&&typeof r.name==='string'&&r.name.trim()&&['뚝섬점','혜화점'].includes(r.store)&&typeof r.active==='boolean');for(const r of b.leaveRequests)assert(/^[1-9]\d*$/.test(String(r.id))&&BigInt(r.id)<9223372036854775807n&&b.staffAccounts.some(a=>a.username===r.username)&&['대기','승인','반려','취소'].includes(r.status)&&typeof r.reason==='string'&&new Date(r.day).toISOString().slice(0,10)===r.day&&Number.isFinite(Date.parse(r.created_at))&&(r.decided_at===null||Number.isFinite(Date.parse(r.decided_at))));}
  assert(b.payrollSettings.length>0,'Missing wage settings');
}
async function main(){
  assert(file,'Usage: node restore-backup.js backup.json [--apply]');
  assert(!flag || flag==='--apply');
  const b=JSON.parse(fs.readFileSync(file,'utf8')); validate(b);
  console.log('Validated counts:',b.records.length,b.scheduleRules.length,b.payrollSettings.length);
  if(!flag) return console.log('Dry run: no database connection or writes');
  assert(process.env.RESTORE_DATABASE_URL,'Set RESTORE_DATABASE_URL to NEW target database');
  assert(process.env.DATABASE_URL,'Set DATABASE_URL to current production database for safety comparison');
  const identity = value => { const u = new URL(value); assert(['postgres:', 'postgresql:'].includes(u.protocol), 'Invalid database URL'); assert(u.hostname && u.pathname.length > 1, 'Invalid database target'); return JSON.stringify([u.hostname.toLowerCase(), u.port || '5432', decodeURIComponent(u.pathname.slice(1))]); };
  assert(identity(process.env.RESTORE_DATABASE_URL) !== identity(process.env.DATABASE_URL), 'Restore target matches production database');
  const {Pool} = require('pg');
  const pool=new Pool({connectionString:process.env.RESTORE_DATABASE_URL});
  try { const c=await pool.connect(); try {
    await c.query('BEGIN');
    await c.query('LOCK TABLE records, schedule_rules, payroll_settings, staff_accounts, leave_requests IN ACCESS EXCLUSIVE MODE');
    for(const t of ['records','schedule_rules','staff_accounts','leave_requests']) assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n,0,'Target contains data');
    const settings=(await c.query('SELECT year,min_wage FROM payroll_settings ORDER BY year')).rows;
    assert(settings.length===0 || JSON.stringify(settings)===JSON.stringify([{year:'2025',min_wage:10030},{year:'2026',min_wage:10320}]),'Target contains custom wage settings');
    await c.query('DELETE FROM payroll_settings');
    for(const r of b.records) await c.query('INSERT INTO records(id,store,day,tab,data,version) VALUES($1,$2,$3,$4,$5,$6)',[r.id,r.store,r.day,r.tab,r.data,r.version]);
    for(const r of b.scheduleRules) await c.query('INSERT INTO schedule_rules(name,data) VALUES($1,$2)',[r.name,r.data]);
    for(const r of b.payrollSettings) await c.query('INSERT INTO payroll_settings(year,min_wage) VALUES($1,$2)',[r.year,r.min_wage]);
    for(const r of b.staffAccounts||[]) await c.query('INSERT INTO staff_accounts(username,name,store,active,password_hash) VALUES($1,$2,$3,false,$4)',[r.username,r.name,r.store,await require('./staff').hash(require('node:crypto').randomBytes(32).toString('hex'))]);
    for(const r of b.leaveRequests||[]) await c.query('INSERT INTO leave_requests(id,username,day,reason,status,created_at,decided_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[r.id,r.username,r.day,r.reason,r.status,r.created_at,r.decided_at]);
    await c.query("SELECT setval(pg_get_serial_sequence('leave_requests','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM leave_requests");
    await c.query("SELECT setval(pg_get_serial_sequence('records','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM records");
    await c.query('COMMIT'); console.log('Restore committed');
  } catch(e){await c.query('ROLLBACK'); throw e;} finally{c.release();} } finally{await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
