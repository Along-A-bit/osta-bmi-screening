import {createServer} from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import worker from '../dist/server/index.js';

const operator='screening-admin@example.invalid';
const hash=value=>createHash('sha256').update(value).digest();
const hour=60*60*1000;
const loginHtml=message=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>管理员登录 · 骨衡</title><link rel="stylesheet" href="/style.css"><main class="admin"><section class="card login"><h1>管理员登录</h1><p>输入管理员口令，查看筛查记录与随访进度。</p><form method="post" action="/admin/login"><label>管理员口令<input name="password" type="password" autocomplete="current-password" required></label>${message?'<p class="error" role="alert">'+message+'</p>':''}<button class="action">登录</button></form></section></main></html>`;
const loginPage=(message='',status=200)=>new Response(loginHtml(message),{status,headers:{
  'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
}});

async function passwordFrom(req){
  let size=0;
  const chunks=[];
  for await(const chunk of req.body??[]){
    size+=chunk.length;
    if(size>4096)return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString()).get('password')||'';
}

export function createPasswordApp(db,password,{secureCookies=false,acceptanceId}={}){
  const sessions=new Map(), failures=new Map();
  const cookie=secureCookies?'__Host-screening_admin':'local_screen_admin';
  const flags='; HttpOnly; SameSite=Strict; Path=/'+(secureCookies?'; Secure':'');
  const expected=password?hash(password):null;
  const redirect=value=>new Response(null,{status:303,headers:{
    Location:'/admin','Set-Cookie':cookie+'='+value+flags,'Cache-Control':'no-store'
  }});
  const clearExpired=(map,now)=>{
    for(const [key,entry] of map)if(entry.until<=now)map.delete(key);
  };
  return async function handle(req,peer='local'){
    const url=new URL(req.url);
    const token=(req.headers.get('Cookie')||'').split(';').map(s=>s.trim())
      .find(s=>s.startsWith(cookie+'='))?.slice(cookie.length+1);
    const now=Date.now();
    if(url.pathname==='/admin/login'||url.pathname==='/signin-with-chatgpt'){
      if(req.method==='GET')return loginPage();
      if(req.method!=='POST'||req.headers.get('origin')!==url.origin)return new Response(null,{status:403});
      if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return new Response(null,{status:415});
      clearExpired(failures,now);
      const failure=failures.get(peer);
      if(failure?.count>=12)return loginPage('尝试次数过多，请在 10 分钟后重试。',429);
      const value=await passwordFrom(req);
      if(value===null)return new Response(null,{status:413});
      if(!expected||!timingSafeEqual(expected,hash(value))){
        failures.set(peer,{count:(failure?.count||0)+1,until:failure?.until??now+600000});
        return loginPage('口令有误，请重新输入。',403);
      }
      failures.delete(peer);clearExpired(sessions,now);
      if(token)sessions.delete(token);
      const key=randomBytes(32).toString('hex');
      sessions.set(key,{until:now+hour});
      return redirect(key+'; Max-Age=3600');
    }
    if(url.pathname==='/admin/logout'||url.pathname==='/signout-with-chatgpt'){
      sessions.delete(token);
      return redirect('; Max-Age=0');
    }
    const headers=new Headers();
    for(const name of ['content-type','origin'])if(req.headers.has(name))headers.set(name,req.headers.get(name));
    // Only this server's verified session can supply the identity seen by the shared API.
    if(sessions.get(token)?.until>now){
      headers.set('oai-authenticated-user-email',operator);
      headers.set('oai-authenticated-user-id','screening-operator');
    }
    return worker.fetch(new Request(req,{headers}),{DB:db,ADMIN_EMAILS:operator,ACCEPTANCE_PARTICIPANT_ID:acceptanceId});
  };
}

export function screeningServer(db,password,{publicOrigin,acceptanceId}={}){
  const handle=createPasswordApp(db,password,{secureCookies:Boolean(publicOrigin),acceptanceId});
  return createServer(async(incoming,outgoing)=>{
    try{
      if(incoming.method==='GET'&&incoming.url==='/healthz'){
        db.prepare('SELECT 1').first();
        outgoing.writeHead(200,{'Cache-Control':'no-store'}).end('ok');return;
      }
      const base=publicOrigin||'http://127.0.0.1:'+incoming.socket.localPort;
      const url=new URL(incoming.url,base);
      if(url.origin!==base||incoming.headers.host!==new URL(base).host){outgoing.writeHead(403).end();return;}
      const hasBody=!['GET','HEAD'].includes(incoming.method);
      const req=new Request(url,{method:incoming.method,headers:incoming.headers,...(hasBody?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
      const res=await handle(req,(publicOrigin&&incoming.headers['x-real-ip'])||incoming.socket.remoteAddress);
      outgoing.writeHead(res.status,Object.fromEntries(res.headers));
      if(res.body)await pipeline(Readable.fromWeb(res.body),outgoing);
      else outgoing.end();
    }catch{
      if(!outgoing.headersSent)outgoing.writeHead(500);
      outgoing.end();
    }
  });
}
