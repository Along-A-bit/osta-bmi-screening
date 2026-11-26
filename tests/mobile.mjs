import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {localServer,createLocalApp} from '../scripts/local.mjs';
import {openDatabase} from '../scripts/sqlite.mjs';

const {chromium}=createRequire(import.meta.url)('playwright');
const db=openDatabase();
const password=crypto.randomUUID();
const server=localServer(db,password);
const offline=process.argv.includes('--in-process');
const handle=createLocalApp(db,password);
async function dispatch(request) {
  return handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),body:request.postDataBuffer()||undefined}));
}
const directory=await mkdtemp(join(tmpdir(),'screening-qa-'));
let browser;
try {
  if(!offline){server.listen(0,'127.0.0.1');await once(server,'listening');}
  const origin='http://127.0.0.1:'+(offline?4173:server.address().port);
  browser=await chromium.launch({headless:true,downloadsPath:directory,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN'});
  if(offline)await context.route(origin+'/**',async route=>{
    const res=await dispatch(route.request());
    // Browser interception does not forward synthetic HTTP redirects. Apply the
    // cookie issued by the real login handler and navigate as a fresh request.
    if(res.status===303){
      const [name,value]=res.headers.get('Set-Cookie').split(';')[0].split('=');
      await context.addCookies([{name,value,url:origin,httpOnly:true,sameSite:'Strict'}]);
      assert.equal(res.headers.get('Location'),'/admin');
      await route.fulfill({status:200,contentType:'text/html',body:'<meta http-equiv="refresh" content="0;url=/admin">'});
      return;
    }
    await route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())});
  });
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.goto(origin);
  const fill=async(weight)=>{
    await page.getByLabel('年龄',{exact:true}).fill('70');
    await page.getByRole('radio',{name:'女',exact:true}).check();
    await page.getByRole('radio',{name:'已绝经',exact:true}).check();
    await page.getByLabel('身高',{exact:true}).fill('160');
    await page.getByLabel('体重单位').selectOption('jin');
    await page.getByLabel('体重',{exact:true}).fill(weight);
  };
  await fill('90');
  let dropped=false;
  await page.route('**/api/screenings',async route=>{
    if(dropped){await route.fallback();return;}
    // Commit the record, then lose its acknowledgement before the browser sees it.
    dropped=true;
    assert.equal(offline?(await dispatch(route.request())).status:(await route.fetch()).status(),200);
    await route.abort('failed');
  });
  await page.getByRole('button',{name:'查看筛查结果'}).click();
  await page.getByRole('button',{name:'重试保存'}).waitFor();
  const cards=page.locator('.metric');
  assert.match(await cards.nth(0).innerText(),/OSTA[\s\S]*-5[\s\S]*筛查风险 · 高风险/);
  assert.ok(await cards.nth(1).getByText('体重过低',{exact:true}).isVisible());
  assert.match(await cards.nth(1).innerText(),/BMI[\s\S]*17.6[\s\S]*体重过低/);
  await page.reload();
  await page.getByRole('button',{name:'重试保存'}).click();
  await page.getByText('记录已保存',{exact:true}).waitFor();
  const id=await page.locator('.receipt code').first().textContent();
  await page.getByText('查看复测凭证').click();
  const proof=await page.locator('.receipt details code').textContent();
  await page.getByRole('button',{name:'修改本次填写'}).click();
  await page.getByLabel('体重',{exact:true}).fill('91');
  await page.getByRole('button',{name:'保存本次更正'}).click();
  await page.getByText('记录已保存',{exact:true}).waitFor();
  assert.match(await cards.nth(0).innerText(),/-4[\s\S]*筛查风险 · 中风险/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM screenings').first().n,1);
  await page.getByRole('button',{name:'结束并返回首页'}).click();
  await page.getByRole('radio',{name:'复测',exact:true}).check();
  await page.getByLabel('参与者编号',{exact:true}).fill(id);
  await page.getByLabel('复测凭证',{exact:true}).fill(proof);
  await fill('160');
  await page.getByRole('button',{name:'查看筛查结果'}).click();
  await page.getByText('记录已保存',{exact:true}).waitFor();
  assert.match(await cards.nth(0).innerText(),/筛查风险 · 低风险/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(origin+'/admin');
  await page.getByRole('link',{name:'登录管理后台'}).click();
  await page.getByLabel('管理员口令').fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('heading',{name:'筛查记录',exact:true}).waitFor();
  await page.locator('.row').nth(1).waitFor();
  await page.locator('.row').last().getByRole('button',{name:'详情 / 更正'}).click();
  await page.getByLabel('体重',{exact:true}).fill('100');
  await page.getByRole('button',{name:'保存更正'}).click();
  await page.getByText('修改已保存').waitFor();
  assert.match(await page.locator('#editor').innerText(),/OSTA -4 · 中风险/);
  await page.locator('#editor').getByLabel('跟进状态').selectOption('已沟通');
  await page.getByRole('button',{name:'保存跟进状态'}).click();
  await page.locator('.row').filter({hasText:'已沟通'}).waitFor();
  await page.getByLabel('筛查风险',{exact:true}).selectOption('中风险');
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await page.getByText('1 条',{exact:true}).waitFor();
  assert.equal(await page.locator('.row').count(),1);
  const event=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出筛选结果 CSV'}).click();
  const file=join(directory,'filtered.csv');
  await (await event).saveAs(file);
  const csv=await readFile(file,'utf8');
  assert.equal(csv.split('\r\n').length,2);
  assert.ok(csv.includes(id)&&csv.includes('已沟通'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM screenings').first().n,2);
  assert.deepEqual(errors,[]);
  console.log('手机竖屏填写、失去回执后重试、更正与复测、管理员登录、筛选和 CSV 下载全部通过。');
} finally {
  await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  db.close();
  await rm(directory,{recursive:true,force:true});
}
