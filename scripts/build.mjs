import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFile(path.join(root,p),'utf8');
const assets={};
for(const entry of await readdir(path.join(root,'web'),{recursive:true,withFileTypes:true})){
  if(!entry.isFile())continue;
  const file=path.join(entry.parentPath,entry.name);
  assets['/'+path.relative(path.join(root,'web'),file).replaceAll('\\','/')]=await readFile(file,'utf8');
}
const shared=await read('src/screen.js');
assets['/screen.js']=shared;
const api=(await read('src/api.js')).replace(/^import [^\n]+\n/,'');
const worker=shared+'\n'+api+'\nconst assets='+JSON.stringify(assets)+';\n'+await read('src/worker.js');
await mkdir(path.join(root,'dist/server'),{recursive:true});
await mkdir(path.join(root,'dist/.openai'),{recursive:true});
await writeFile(path.join(root,'dist/server/index.js'),worker);
await copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
console.log('Worker built with '+Object.keys(assets).length+' bundled local assets.');
