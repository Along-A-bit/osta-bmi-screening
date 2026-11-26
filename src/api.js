import {evaluate, followStates, risks, toCsv} from './screen.js';

const rules = {
  participant:/^P[A-F0-9]{16}$/, proof:/^[a-f0-9]{32}$/,
  requestId:/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
};
const columns = ['age','sex','menopause','height','weight','unit','kg','osta','risk','reason','bmi','category'];
const visible = ['id','participant','created','updated',...columns,'follow','version'].join(',');
class Problem extends Error {
  constructor(status,message){super(message);this.status=status;}
}
const check=(ok,status,message)=>{if(!ok) throw new Problem(status,message);};
async function digest(text) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function compute(raw) {
  try{return evaluate(raw);}catch(err){throw new Problem(422,err.message);}
}
async function body(req) {
  check(req.headers.get('Content-Type')?.split(';')[0]==='application/json',415,'请使用网页表单提交');
  const reader=req.body?.getReader();
  check(reader,400,'缺少填写内容');
  let len=0;
  const decoder=new TextDecoder();
  let text='';
  for (;;) {
    const {value,done}=await reader.read(); if(done) break;
    len+=value.length;
    if(len>12000){await reader.cancel();throw new Problem(413,'提交内容过长');}
    text+=decoder.decode(value,{stream:true});
  }
  try{const data=JSON.parse(text+decoder.decode());if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}
  catch{throw new Problem(400,'请核对提交内容');}
}
function isAdmin(req,env) {
  const email=req.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  return Boolean(email && req.headers.get('oai-authenticated-user-id') && (env.ADMIN_EMAILS||'').split(',').some(x=>x.trim().toLowerCase()===email));
}
async function save(db,raw) {
  for (const [key,pattern] of Object.entries(rules)) check(typeof raw[key]==='string'&&pattern.test(raw[key]),422,'参与者编号、复测凭证或提交标识无效');
  check(['new','repeat'].includes(raw.mode),422,'请选择初次筛查或复测');
  const result=compute(raw);
  const {participant,proof,requestId}=raw;
  const proofHash=await digest(proof);
  const submitted=await digest(JSON.stringify([participant,raw.mode,result]));
  const now=new Date().toISOString();
  const measures=columns.map(k=>result[k]);
  const statements=[];
  if(raw.mode==='new') statements.push(db.prepare('INSERT INTO participants(id,proof_hash) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM screenings WHERE id=?) ON CONFLICT(id) DO NOTHING').bind(participant,proofHash,requestId));
  statements.push(db.prepare('INSERT INTO screenings(id,participant,submitted_hash,created,updated,'+columns.join(',')+') SELECT '+Array(5+columns.length).fill('?').join(',')+' FROM participants WHERE id=? AND proof_hash=? ON CONFLICT(id) DO NOTHING').bind(requestId,participant,submitted,now,now,...measures,participant,proofHash));
  statements.push(db.prepare('SELECT s.submitted_hash FROM screenings s JOIN participants p ON p.id=s.participant WHERE s.id=? AND p.id=? AND p.proof_hash=?').bind(requestId,participant,proofHash));
  const batch=await db.batch(statements);
  const saved=batch.at(-1).results[0];
  check(saved,403,'保存未完成，请核对参与者编号及复测凭证');
  check(saved.submitted_hash===submitted,409,'本次提交标识已使用，请重新开始筛查');
  return response({participant,saved:true});
}
function filter(params) {
  const clauses=[], bindings=[];
  const add=(sql,val)=>{clauses.push(sql);bindings.push(val);};
  for(const [key,allowed] of [['risk',risks],['follow',followStates]]) {
    const value=params.get(key);
    if(value){check(allowed.includes(value),422,'筛选条件无效');add(key+'=?',value);}
  }
  if(params.get('participant'))add('participant=?',params.get('participant').trim().toUpperCase());
  for(const key of ['from','to']) {
    const day=params.get(key);if(!day) continue;
    const time=Date.parse(day+'T00:00:00+08:00');
    check(/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(time),422,'日期格式有误');
    check(new Date(time+8*3600000).toISOString().slice(0,10)===day,422,'请输入有效日期');
    add(key==='from'?'created>=?':'created<?',new Date(time+(key==='to'?86400000:0)).toISOString());
  }
  check(!(params.get('from')&&params.get('to')&&params.get('from')>params.get('to')),422,'起始日期不能晚于结束日期');
  return {where:clauses.length?' WHERE '+clauses.join(' AND '):'',bindings};
}
async function adminList(db,url) {
  const {where,bindings}=filter(url.searchParams);
  const offset=Number(url.searchParams.get('offset')||0);
  check(Number.isSafeInteger(offset)&&offset>=0,400,'页码有误');
  const qs=[
    db.prepare('SELECT '+visible+' FROM screenings'+where+' ORDER BY created DESC,rowid DESC LIMIT 100 OFFSET ?').bind(...bindings,offset),
    db.prepare('SELECT COUNT(*) AS n FROM screenings'+where).bind(...bindings),
    db.prepare('WITH ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY participant ORDER BY created DESC,rowid DESC) AS n FROM screenings) SELECT risk,COUNT(*) AS n FROM ranked'+(where?where+' AND':' WHERE')+' n=1 GROUP BY risk').bind(...bindings)
  ];
  const [list,total,groups]=await db.batch(qs);
  return response({rows:list.results,total:total.results[0].n,groups:groups.results});
}
async function exportRecords(db,url) {
  const {where,bindings}=filter(url.searchParams);
  const condition=where ? where+' AND ' : ' WHERE ';
  const newest=await db.prepare('SELECT COALESCE(MAX(rowid),0) AS last FROM screenings').first();
  let cursor=newest.last+1;
  let header=true;
  const encoder=new TextEncoder();
  const stream=new ReadableStream({
    async pull(controller) {
      const {results}=await db.prepare('SELECT rowid AS ordinal,'+visible+' FROM screenings'+condition+'rowid<? ORDER BY rowid DESC LIMIT 100').bind(...bindings,cursor).all();
      if(!header && !results.length){controller.close();return;}
      const csv=toCsv(results);
      const chunk=header ? csv : csv.slice(csv.indexOf('\r\n')+2);
      controller.enqueue(encoder.encode((header?'':'\r\n')+chunk));
      header=false;
      if(results.length<100){controller.close();return;}
      cursor=results.at(-1).ordinal;
    }
  });
  return new Response(stream,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="screenings.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
async function update(db,id,raw) {
  check(rules.requestId.test(id)&&Number.isSafeInteger(raw.version)&&raw.version>=1,422,'记录标识或版本无效');
  const fields=[],values=[];
  if(raw.action==='correct'){
    const value=compute(raw);
    for(const k of columns){fields.push(k+'=?');values.push(value[k]);}
  }else{
    check(raw.action==='follow'&&followStates.includes(raw.follow),422,'跟进状态无效');
    fields.push('follow=?');values.push(raw.follow);
  }
  const changed=await db.prepare('UPDATE screenings SET '+fields.join(',')+',updated=?,version=version+1 WHERE id=? AND version=?').bind(...values,new Date().toISOString(),id,raw.version).run();
  check(changed.meta.changes===1,409,'此记录已变更，请刷新后重试');
  return response({saved:true});
}
export async function api(req,env) {
  try {
    const url=new URL(req.url),p=url.pathname;
    if(req.method!=='GET'){
      const origin=req.headers.get('Origin');
      check(!origin || origin===url.origin,403,'请从本站提交');
    }
    if(p.startsWith('/api/admin/')) check(isAdmin(req,env),403,'请使用已获授权的管理员账号登录');
    if(p==='/api/admin/session'&&req.method==='GET')return response({admin:true});
    if(p==='/api/screenings'&&req.method==='POST')return await save(env.DB,await body(req));
    if(p==='/api/admin/records'&&req.method==='GET')return await adminList(env.DB,url);
    if(p==='/api/admin/export.csv'&&req.method==='GET')return await exportRecords(env.DB,url);
    if(p.startsWith('/api/admin/records/')&&req.method==='PATCH')return await update(env.DB,p.split('/').at(-1),await body(req));
    return response({error:'无此接口'},404);
  } catch(err){return response({error:err instanceof Problem?err.message:'暂时无法访问数据库，请稍后重试'},err instanceof Problem?err.status:503);}
}
