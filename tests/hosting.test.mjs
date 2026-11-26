import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startRailway} from '../scripts/railway.mjs';
import {freshAccess} from '../src/screen.js';

test('独立托管使用持久卷，重启后保留筛查，后台要求重新登录',async t=>{
  const mount=await mkdtemp(join(tmpdir(),'screening-volume-'));
  const config={PORT:'0',RAILWAY_VOLUME_MOUNT_PATH:mount,RAILWAY_PUBLIC_DOMAIN:'screening.example.invalid',ADMIN_PASSWORD:crypto.randomUUID()};
  let server;
  const stop=async()=>{if(server?.listening)await new Promise(resolve=>server.close(resolve));};
  t.after(async()=>{await stop();await rm(mount,{recursive:true,force:true});});
  const start=async()=>{server=startRailway(config);await once(server,'listening');};
  async function fetchApp(path,method='GET',headers={},body){
    const req=request({host:'127.0.0.1',port:server.address().port,path,method,headers:{Host:config.RAILWAY_PUBLIC_DOMAIN,...headers}});
    const response=once(req,'response');req.end(body);
    const [res]=await response;
    const chunks=[];for await(const chunk of res)chunks.push(chunk);
    return {status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()};
  }
  const origin='https://'+config.RAILWAY_PUBLIC_DOMAIN;
  const login=()=>fetchApp('/admin/login','POST',{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({password:config.ADMIN_PASSWORD}).toString());
  assert.throws(()=>startRailway({...config,RAILWAY_VOLUME_MOUNT_PATH:''}),/持久卷/);
  await start();
  assert.equal((await fetchApp('/healthz')).status,200);
  const submitted={...freshAccess(),age:70,height:160,weight:91,unit:'jin',sex:'女',menopause:'已绝经',mode:'new',requestId:crypto.randomUUID()};
  assert.equal((await fetchApp('/api/screenings','POST',{Origin:origin,'Content-Type':'application/json'},JSON.stringify(submitted))).status,200);
  const first=await login();assert.equal(first.status,303);
  const rawCookie=first.headers['set-cookie'][0];assert.match(rawCookie,/; Secure/);assert.match(rawCookie,/; HttpOnly/);
  const cookie=rawCookie.split(';')[0];
  assert.equal((await fetchApp('/api/admin/records','GET',{Cookie:cookie})).status,200);
  await stop();await start();
  assert.equal((await fetchApp('/api/admin/records','GET',{Cookie:cookie})).status,403);
  const fresh=(await login()).headers['set-cookie'][0].split(';')[0];
  const list=JSON.parse((await fetchApp('/api/admin/records','GET',{Cookie:fresh})).text);
  assert.equal(list.total,1);assert.deepEqual([list.rows[0].participant,list.rows[0].osta,list.rows[0].kg],[submitted.participant,-4,45.5]);
  assert.equal((await fetchApp('/api/admin/export.csv')).status,403);
});
