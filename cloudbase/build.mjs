import {cp,copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
const out = path.resolve(process.argv[2] || path.join(root,'dist/cloudbase'));
const assetDir = path.join(out,'assets-v1');
const env = process.env.CLOUDBASE_ENV_ID;
const key = process.env.CLOUDBASE_PUBLISHABLE_KEY;
const claims = JSON.parse(Buffer.from(key?.split('.')[1] || 'e30','base64url').toString());
if (!/^[a-z0-9-]+$/.test(env || '') || claims.role!=='anon' || claims.scope!=='anonymous' || claims.sub!=='anon' || claims.is_system_admin===true) {
  throw Error('请配置 CloudBase 环境 ID 和客户端 Publishable Key');
}
await mkdir(assetDir,{recursive:true});
await cp(path.join(root,'web/vendor'),path.join(assetDir,'vendor'),{recursive:true});
for (const file of ['style.css','base.js','public.js','admin.js']) {
  await copyFile(path.join(root,'web',file),path.join(assetDir,file));
}
for (const file of ['client.js','login.js']) {
  await copyFile(path.join(root,'cloudbase',file),path.join(assetDir,file));
}
await writeFile(path.join(assetDir,'transport.js'),"export {request,csvBlob} from './client.js';\n");
await copyFile(path.join(root,'src/screen.js'),path.join(assetDir,'screen.js'));
await writeFile(path.join(assetDir,'config.js'),
  'export const apiOrigin = '+JSON.stringify('https://'+env+'.api.tcloudbasegateway.com')+';\n'+
  'export const publishKey = '+JSON.stringify(key)+';\n');
await copyFile(path.join(root,'cloudbase/login.html'),path.join(out,'login.html'));
for (const name of ['index.html','admin.html']) {
  const html = (await readFile(path.join(root,'web',name),'utf8'))
    .replaceAll('href="/admin/logout"', 'href="./login.html?logout=1"')
    .replaceAll('href="/admin/login"', 'href="./login.html"')
    .replaceAll('href="/admin"', 'href="./admin.html"')
    .replaceAll('href="/"', 'href="./index.html"')
    .replaceAll('href="/','href="./assets-v1/').replaceAll('src="/','src="./assets-v1/')
    .replace('提交后将保存本次筛查，供工作人员查看和随访。','本页仅供测试，请填写模拟信息；提交后测试管理员可查看本次记录。')
    .replace('>健康筛查<','>模拟筛查测试<').replace('>随访工作台<','>测试记录工作台<');
  await writeFile(path.join(out,name),html);
}
