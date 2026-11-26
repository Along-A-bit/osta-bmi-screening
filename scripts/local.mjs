import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase} from './sqlite.mjs';
import {screeningServer} from './server.mjs';
export {createPasswordApp as createLocalApp,screeningServer as localServer} from './server.mjs';

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  mkdirSync('.local',{recursive:true});
  const db=openDatabase('.local/screenings.sqlite');
  const server=screeningServer(db,process.env.LOCAL_ADMIN_PASSWORD);
  server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('本地筛查页面 http://127.0.0.1:'+server.address().port));
  server.on('close',()=>db.close());
}
