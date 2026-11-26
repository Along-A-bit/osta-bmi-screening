import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual, createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {openDatabase} from './sqlite.mjs';
import worker from '../dist/server/index.js';

const operator = 'local-admin@example.invalid';
const cookie = 'local_screen_admin';
const hash = value => createHash('sha256').update(value).digest();
const loginForm = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地管理员登录</title><form method="post"><label>本地管理员口令 <input name="password" type="password" required></label><button>登录</button></form></html>';

// Only the loopback development server uses this login. Hosted traffic uses Sites sign-in.
export function createLocalApp(db,password) {
  const sessions = new Map();
  return async function handle(req) {
    const url=new URL(req.url);
    const token=(req.headers.get('Cookie')||'').split(';').map(v=>v.trim())
      .find(v=>v.startsWith(cookie+'='))?.slice(cookie.length+1);
    if (url.pathname==='/signin-with-chatgpt') {
      if(req.method==='GET')return new Response(loginForm,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      if(req.method!=='POST'||req.headers.get('origin')!==url.origin)return new Response(null,{status:403});
      const text=await req.text();
      if(text.length>4096)return new Response(null,{status:413});
      const value=new URLSearchParams(text).get('password')||'';
      if(!password || !timingSafeEqual(hash(value),hash(password)))return new Response(null,{status:403});
      const key=randomBytes(32).toString('hex');
      sessions.set(key,Date.now()+3600000);
      return new Response(null,{status:303,headers:{Location:'/admin','Set-Cookie':cookie+'='+key+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600','Cache-Control':'no-store'}});
    }
    if(url.pathname==='/signout-with-chatgpt') {
      sessions.delete(token);
      return new Response(null,{status:303,headers:{Location:'/admin','Set-Cookie':cookie+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}});
    }
    const headers=new Headers();
    for(const name of ['content-type','origin'])if(req.headers.has(name))headers.set(name,req.headers.get(name));
    const expiry=sessions.get(token);
    if(expiry>Date.now()) {
      // Drop all client-provided identity headers; only the authenticated session supplies these.
      headers.set('oai-authenticated-user-email',operator);
      headers.set('oai-authenticated-user-id','local-operator');
    }else if(expiry)sessions.delete(token);
    return worker.fetch(new Request(req,{headers}),{DB:db,ADMIN_EMAILS:operator});
  };
}
export function localServer(db,password) {
  const handle=createLocalApp(db,password);
  return createServer(async(incoming,outgoing)=>{
    try{
      const base='http://127.0.0.1:'+incoming.socket.localPort;
      if(incoming.headers.host!==new URL(base).host){outgoing.writeHead(403).end();return;}
      const hasBody=!['GET','HEAD'].includes(incoming.method);
      const req=new Request(new URL(incoming.url,base),{method:incoming.method,headers:incoming.headers,...(hasBody?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
      const res=await handle(req);
      outgoing.writeHead(res.status,Object.fromEntries(res.headers));
      if(res.body)await pipeline(Readable.fromWeb(res.body),outgoing);
      else outgoing.end();
    }catch{
      if(!outgoing.headersSent)outgoing.writeHead(500);
      outgoing.end();
    }
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  mkdirSync('.local',{recursive:true});
  const db=openDatabase('.local/screenings.sqlite');
  const server=localServer(db,process.env.LOCAL_ADMIN_PASSWORD);
  server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('本地筛查页面 http://127.0.0.1:'+server.address().port));
  server.on('close',()=>db.close());
}
