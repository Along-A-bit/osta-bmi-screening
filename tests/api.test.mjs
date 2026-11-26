import test from 'node:test';
import assert from 'node:assert/strict';
import {freshAccess} from '../src/screen.js';
import {openDatabase} from '../scripts/sqlite.mjs';
import {createLocalApp} from '../scripts/local.mjs';
import {api} from '../src/api.js';

async function fixture(t) {
  const db=openDatabase();
  const password=crypto.randomUUID();
  t.after(()=>db.close());
  const handle=createLocalApp(db,password);
  const base='http://127.0.0.1';
  const fetchPath=(path,opts)=>handle(new Request(base+path,opts));
  const signin=await fetchPath('/signin-with-chatgpt',{method:'POST',body:new URLSearchParams({password}),headers:{Origin:base},redirect:'manual'});
  assert.equal(signin.status,303);
  const cookie=signin.headers.get('set-cookie').split(';')[0];
  const admin=(path,opts={})=>fetchPath('/api/admin/'+path,{...opts,headers:{cookie,...opts.headers}});
  const post=data=>fetchPath('/api/screenings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const patch=(id,data)=>admin('records/'+id,{method:'PATCH',body:JSON.stringify(data),headers:{'content-type':'application/json'}});
  const first={...freshAccess(),age:70,sex:'女',menopause:'已绝经',height:160,weight:90,unit:'jin',mode:'new',requestId:crypto.randomUUID()};
  return {db,base,cookie,fetchPath,admin,post,patch,first};
}
test('数据库幂等、结果重新计算、失败与凭证校验',async t=>{
  const {db,post,admin,first}=await fixture(t);
  const injected={...first,risk:'低风险',osta:99,follow:'已沟通',bmi:999};
  const results=await Promise.all([post(injected),post(injected),post(injected)]);
  assert.deepEqual(results.map(r=>r.status),[200,200,200]);
  assert.equal((await post({...first,weight:100})).status,409);
  assert.equal((await post({...first,...freshAccess()})).status,403);
  assert.equal(db.prepare('SELECT count(*) AS n FROM participants').first().n,1);
  assert.equal((await post({...first,mode:'repeat',proof:'a'.repeat(32),requestId:crypto.randomUUID()})).status,403);
  assert.equal((await post({...first,mode:'repeat',proof:'',requestId:crypto.randomUUID()})).status,422);
  const result=await (await admin('records')).json();
  assert.equal(result.total,1);const r=result.rows[0];
  assert.deepEqual([r.kg,r.weight,r.unit,r.osta,r.risk,r.category,r.follow],[45,90,'jin',-5,'高风险','体重过低','待跟进']);
  assert.equal(r.reason,'');assert.equal(r.bmi,45/2.56);
  assert.ok(!('proof_hash' in r));assert.ok(!('submitted_hash' in r));
  const failed=await api(new Request('https://unit.invalid/api/screenings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(first)}),{DB:{prepare(){throw Error('unavailable');}}});
  assert.equal(failed.status,503);
});
test('更正、并发版本保护、复测、筛选、最新人数和 CSV',async t=>{
  const {db,first,post,patch,admin}=await fixture(t);
  await post(first);
  const initial=(await (await admin('records')).json()).rows[0];
  assert.equal((await patch(initial.id,{...initial,weight:100,version:1,action:'correct'})).status,200);
  assert.equal((await patch(initial.id,{action:'follow',follow:'已沟通',version:1})).status,409);
  assert.equal((await post(first)).status,200);
  const corrected=(await (await admin('records')).json()).rows[0];
  assert.equal(corrected.created,initial.created);assert.equal(corrected.osta,-4);assert.equal(corrected.risk,'中风险');
  await patch(initial.id,{action:'follow',follow:'已沟通',version:2});
  const retest={...first,mode:'repeat',weight:160,requestId:crypto.randomUUID()};
  await post(retest);
  const ineligible={...first,...freshAccess(),sex:'男',requestId:crypto.randomUUID()};
  await post(ineligible);
  const latest=await (await admin('records')).json();
  assert.equal(latest.total,3);assert.deepEqual(Object.fromEntries(latest.groups.map(g=>[g.risk,g.n])),{'不适用':1,'低风险':1});
  const history=await (await admin('records?participant='+first.participant)).json();assert.equal(history.total,2);
  const query=new URLSearchParams({risk:'中风险',follow:'已沟通'});
  const filtered=await (await admin('records?'+query)).json();assert.equal(filtered.total,1);assert.equal(filtered.groups.length,0);
  const csv=await (await admin('export.csv?'+query)).text();
  assert.equal(csv.split('\r\n').length,2);assert.ok(csv.includes(initial.participant));assert.ok(csv.includes('"斤"'));
  assert.ok(!csv.includes(ineligible.participant));assert.ok(!csv.includes(first.proof));
  await patch(initial.id,{action:'follow',follow:'已完成骨密度检查',version:3});
  assert.equal((await (await admin('records?follow='+encodeURIComponent('已完成骨密度检查'))).json()).total,1);
  db.prepare('UPDATE screenings SET created=? WHERE id=?').bind('2026-11-25T16:00:00.000Z',initial.id).run();
  const dated=await (await admin('records?participant='+first.participant+'&from=2026-11-26&to=2026-11-26')).json();
  assert.ok(dated.rows.some(r=>r.id===initial.id));
  assert.equal((await (await admin('records?to=2026-11-25')).json()).rows.some(r=>r.id===initial.id),false);
  assert.equal((await admin('records?from=2026-02-30')).status,422);
});
test('后台访问控制、登出、无公开历史读取接口',async t=>{
  const {db,first,post,fetchPath,cookie}=await fixture(t);await post(first);
  for(const path of ['/api/admin/records','/api/admin/session','/api/admin/export.csv','/api/admin/records?participant='+first.participant]){
    assert.equal((await fetchPath(path)).status,403);
  }
  assert.equal((await fetchPath('/api/admin/records/'+first.requestId,{method:'PATCH'})).status,403);
  assert.equal((await fetchPath('/api/screenings?participant='+first.participant)).status,404);
  const noRole=await api(new Request('https://unit.invalid/api/admin/records',{headers:{'oai-authenticated-user-id':'ordinary','oai-authenticated-user-email':'ordinary@example.invalid'}}),{DB:db,ADMIN_EMAILS:'operator@example.invalid'});
  assert.equal(noRole.status,403);
  assert.equal((await fetchPath('/api/screenings',{method:'POST',headers:{Origin:'https://other.invalid'}})).status,403);
  await fetchPath('/signout-with-chatgpt',{headers:{cookie},redirect:'manual'});
  assert.equal((await fetchPath('/api/admin/records',{headers:{cookie}})).status,403);
});
test('CSV 跨分页的导出保留每条记录',async t=>{
  const {db,first,post,admin}=await fixture(t);await post(first);
  let row=await (await admin('records')).json();assert.equal(row.total,1);
  const measurements=db.prepare('SELECT * FROM screenings').first();
  const keys=Object.keys(measurements);
  const insert=db.prepare('INSERT INTO screenings('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
  for(let i=1;i<100;i++)insert.bind(...keys.map(k=>k==='id'?crypto.randomUUID():measurements[k])).run();
  const lines=async()=> (await (await admin('export.csv')).text()).split('\r\n');
  assert.equal((await lines()).length,101);
  insert.bind(...keys.map(k=>k==='id'?crypto.randomUUID():measurements[k])).run();assert.equal((await lines()).length,102);
});

test('本人更正和重试不增加记录，快捷筛选只取每人最近一次',async t=>{
  const {first,post,fetchPath,admin}=await fixture(t);await post(first);
  const correct=data=>fetchPath('/api/screenings/correct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const change={...first,weight:92,version:1};
  assert.equal((await correct({...change,proof:'0'.repeat(32)})).status,403);
  assert.equal((await correct(change)).status,200);
  assert.equal((await correct(change)).status,200);
  const list=await (await admin('records')).json();
  assert.equal(list.total,1);assert.equal(list.rows[0].osta,-4.8);
  const filter='latest=1&risk='+encodeURIComponent('高风险')+'&follow='+encodeURIComponent('待跟进');
  assert.equal((await (await admin('records?'+filter)).json()).total,1);
  await post({...first,mode:'repeat',weight:170,requestId:crypto.randomUUID()});
  assert.equal((await (await admin('records?'+filter)).json()).total,0);
  assert.equal((await (await admin('export.csv?'+filter)).text()).includes(first.participant),false);
});
