import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename); const root=path.resolve(__dirname,'..'); const dist=path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true}); fs.mkdirSync(dist,{recursive:true});
const copy=(src,dst)=>{ const target = dst === undefined ? src : dst; const s=path.join(root,src), d=path.join(dist,target); if(!fs.existsSync(s)) return; const st=fs.statSync(s); if(st.isDirectory()){fs.mkdirSync(d,{recursive:true}); for(const f of fs.readdirSync(s)) copy(path.join(src,f), path.join(target,f));} else {fs.mkdirSync(path.dirname(d),{recursive:true}); fs.copyFileSync(s,d);} };
copy('index.html'); copy('editor.html'); copy('src'); copy('public','');
console.log('Build complete: dist/');
