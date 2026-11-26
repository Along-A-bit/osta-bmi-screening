import {statSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {screeningServer} from './server.mjs';
import {openDatabase} from './sqlite.mjs';

export function startRailway(env){
  const mount=env.RAILWAY_VOLUME_MOUNT_PATH;
  if(!mount||!isAbsolute(mount)||!statSync(mount).isDirectory())throw Error('请为本服务挂载持久卷，再启动筛查。');
  if(!/^[a-z0-9.-]+$/i.test(env.RAILWAY_PUBLIC_DOMAIN||''))throw Error('请在服务的 Networking 设置生成公开域名并重新部署。');
  if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<16)throw Error('请在服务变量中设置至少 16 个字符的 ADMIN_PASSWORD。');
  const db=openDatabase(join(mount,'screenings.sqlite'));
  const server=screeningServer(db,env.ADMIN_PASSWORD,{
    publicOrigin:'https://'+env.RAILWAY_PUBLIC_DOMAIN,acceptanceId:env.ACCEPTANCE_PARTICIPANT_ID
  });
  server.on('close',()=>db.close());
  return server.listen(Number(env.PORT||8080),'0.0.0.0');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const server=startRailway(process.env);
  process.once('SIGTERM',()=>server.close());
}
