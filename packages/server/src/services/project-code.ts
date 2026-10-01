import {inspectTestSource} from './test-compatibility';
import {assertWrite} from './apphub-rbac';
import {readFile,writeFile,mkdir,mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {and,eq} from 'drizzle-orm';
import {db} from '../db';
import {projects} from '../db/schema';
import {findMemberByUserId} from './permission';
import {accessScope} from './apphub-access';
import {giteaToken} from './gitea-integration';
import {repositoryPath} from './apphub-versions';
import {readCodeArchive,safeCodePath} from './code-archive';
import {versionInput} from './version-api';
type Actor={id:string;organizationId:string;name:string;email:string};
const stageRoot=()=>process.env.APPHUB_CODE_UPLOAD_DIR||path.join(tmpdir(),'apphub-code-previews');
const headers=()=>({Authorization:`token ${giteaToken()}`});
export async function codeProject(a:Actor,id:string){
 const member=await findMemberByUserId(a.id,a.organizationId);
 const p=await db.query.projects.findFirst({where:and(eq(projects.projectId,id),eq(projects.organizationId,a.organizationId)),columns:{projectId:true,name:true,giteaRepoUrl:true}});
 if(!p||!accessScope(member).project(id))throw new Error('项目不存在或尚未授权');
 if(!p.giteaRepoUrl)throw new Error('项目代码空间尚未就绪，请管理员检查后台存储连接');
 return {...p,api:repositoryPath(p.projectId,p.giteaRepoUrl)};
}
// A newly pushed commit can briefly precede the Git service's HTTP read view.
// Retry transient read-only responses; never repeat a write or weaken authorization.
async function readVersion(url:string){
 for(let attempt=0;;attempt++){
  const r=await fetch(url,{headers:headers(),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(![404,409,500,502,503,504].includes(r.status)||attempt===4)return r;
  await r.body?.cancel();await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
 }
}
async function get(url:string,recentVersion=false){const r=recentVersion?await readVersion(url):await fetch(url,{headers:headers(),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('暂时无法读取代码，请稍后重试');return r.json();}
function git(cwd:string,env:NodeJS.ProcessEnv,args:string[],input?:Buffer|string){
 return new Promise<Buffer>((resolve,reject)=>{
  const child=spawn('git',['-c','core.hooksPath=/dev/null','-c','credential.helper=','-c','http.followRedirects=false',...args],{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  let size=0;const chunks:Buffer[]=[];let failed=false;
  const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');},90000);
  child.on('error',()=>{clearTimeout(timer);reject(new Error('后台代码服务无法启动，请联系管理员'));});
  child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>20*1024*1024){failed=true;child.kill('SIGKILL');}else chunks.push(b);});
  child.stderr.on('data',()=>{/* Credentials and upstream diagnostics never reach a browser. */});
  child.on('close',code=>{clearTimeout(timer);if(code||failed)reject(new Error('代码操作未完成，可能存在并发更新或连接异常；请刷新版本记录后重试'));else resolve(Buffer.concat(chunks));});
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
async function repository(a:Actor,id:string){
 const p=await codeProject(a,id),meta=await get(p.api);
 const user=await get((process.env.GITEA_API_URL||'').replace(/\/+$/,'')+'/api/v1/user');
 if(typeof user.login!=='string'||!user.login||!meta.default_branch)throw new Error('后台代码空间配置不完整');
 const dir=await mkdtemp(path.join(tmpdir(),'apphub-code-git-'));
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:'http:https',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+Buffer.from(user.login+':'+giteaToken()).toString('base64'),GIT_AUTHOR_NAME:a.name.replace(/[\r\n<>]/g,' ').slice(0,100)||'AppHub user',GIT_AUTHOR_EMAIL:a.email.replace(/[\r\n<>]/g,''),GIT_COMMITTER_NAME:'AppHub',GIT_COMMITTER_EMAIL:'apphub@local.invalid'};
 const run=(args:string[],input?:Buffer|string)=>git(dir,env,args,input);
 try{
  await run(['init','--bare','.']);const branch=String(meta.default_branch);await run(['check-ref-format','refs/heads/'+branch]);
  const remote=p.api.replace('/api/v1/repos/','/')+'.git';
  let head='';if(!meta.empty){await run(['fetch','--depth=1','--no-tags',remote,'refs/heads/'+branch]);head=(await run(['rev-parse','FETCH_HEAD'])).toString().trim();}
  const rows=head?(await run(['ls-tree','-rz','--full-tree',head])).toString('utf8').split('\0').filter(Boolean):[];
  const tree=rows.map(row=>{const i=row.indexOf('\t');const [mode,type,hash]=row.slice(0,i).split(' ');return {path:row.slice(i+1),hash:hash!,mode:mode!,type};});
  if(tree.length>4000)throw new Error('项目文件数量超出当前网页上传范围，请管理员检查');
  return {p,dir,run,remote,branch,head,tree};
 }catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
type Preview={id:string;projectId:string;organizationId:string;actor:string;createdAt:number;base:string;branch:string;changes:{path:string;kind:string}[];fileCount:number;ignored:string[];removedWrapper:string;stripRoot:boolean};
async function loadPreview(a:Actor,id:string){
 if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('上传预览不存在');
 const p=JSON.parse(await readFile(path.join(stageRoot(),id+'.json'),'utf8')) as Preview;
 if(p.id!==id||p.actor!==a.id||p.organizationId!==a.organizationId||Date.now()-p.createdAt>3600000)throw new Error('上传预览已失效，请重新上传');
 return p;
}
export async function previewCode(a:Actor,id:string,buffer:Buffer,stripRoot=false){
 await assertWrite(a);await codeProject(a,id);const archive=readCodeArchive(buffer,stripRoot);await mkdir(stageRoot(),{recursive:true,mode:0o700});
 let active=0;for(const name of await readdir(stageRoot())){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const file=path.join(stageRoot(),name);try{if(Date.now()-(await stat(file)).mtimeMs>3600000){await rm(file,{force:true});await rm(file.replace(/\.json$/,'.zip'),{force:true});}else{const p=JSON.parse(await readFile(file,'utf8'));if(p.actor===a.id)active++;}}catch{}}
 if(active>=5)throw new Error('待保存的上传预览过多，请先保存或稍后重试');
 const repo=await repository(a,id);
 try{
  const before=new Map(repo.tree.map(f=>[f.path,f])),after=new Map(archive.files.map(f=>[f.path,f]));
  const changes:Preview['changes']=[];
  for(const f of archive.files){const old=before.get(f.path);if(!old)changes.push({path:f.path,kind:'新增'});else if(old.hash!==f.hash||old.mode!==f.mode)changes.push({path:f.path,kind:'修改'});}
  for(const f of repo.tree)if(!after.has(f.path))changes.push({path:f.path,kind:'移除'});
  const preview:Preview={id:randomUUID(),projectId:id,organizationId:a.organizationId,actor:a.id,createdAt:Date.now(),base:repo.head,branch:repo.branch,changes,fileCount:archive.files.length,ignored:archive.ignored,removedWrapper:archive.removedWrapper,stripRoot};
  await writeFile(path.join(stageRoot(),preview.id+'.zip'),buffer,{mode:0o600});await writeFile(path.join(stageRoot(),preview.id+'.json'),JSON.stringify(preview),{mode:0o600});
  return {id:preview.id,changes,fileCount:preview.fileCount,ignored:preview.ignored,removedWrapper:preview.removedWrapper,compatibility:inspectTestSource(archive.files)};
 }finally{await rm(repo.dir,{recursive:true,force:true});}
}
export async function commitCode(a:Actor,input:{previewId:string;name:string;description:string;projectId?:string}){
 await assertWrite(a);const preview=await loadPreview(a,input.previewId);if(input.projectId&&input.projectId!==preview.projectId)throw new Error('上传预览不属于授权项目');
 versionInput.parse({projectId:preview.projectId,name:input.name,commit:'0'.repeat(40),description:input.description});
 const archive=readCodeArchive(await readFile(path.join(stageRoot(),input.previewId+'.zip')),preview.stripRoot),repo=await repository(a,preview.projectId);
 try{
  if(repo.head!==preview.base||repo.branch!==preview.branch)throw new Error('项目代码已被其他人更新，请重新上传并核对变更');
  const exists=await fetch(repo.p.api+'/tags/'+encodeURIComponent(input.name),{headers:headers(),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(exists.ok)throw new Error('版本名称已存在，请使用新的版本号');if(exists.status!==404)throw new Error('无法核对版本名称，请稍后重试');
  await repo.run(['read-tree','--empty']);const index:Buffer[]=[];
  for(const f of archive.files){const hash=(await repo.run(['hash-object','-w','--stdin'],f.data)).toString().trim();if(hash!==f.hash)throw new Error('文件校验失败');index.push(Buffer.from(`${f.mode} ${hash}\t${f.path}\0`));}
  await repo.run(['update-index','-z','--index-info'],Buffer.concat(index));const tree=(await repo.run(['write-tree'])).toString().trim();
  const sha=(await repo.run(['commit-tree',tree,...(repo.head?['-p',repo.head]:[]),'-F','-'],`版本 ${input.name}\n\n${input.description}\n\nAppHub-User: ${a.id}\n`)).toString().trim();
  await codeProject(a,preview.projectId);
  // CAS protects the branch, atomic push protects branch and tag together; never overwrite a version.
  await repo.run(['push','--atomic',`--force-with-lease=refs/heads/${repo.branch}:${repo.head}`,repo.remote,`${sha}:refs/heads/${repo.branch}`,`${sha}:refs/tags/${input.name}`]);
  await rm(path.join(stageRoot(),input.previewId+'.json'),{force:true});await rm(path.join(stageRoot(),input.previewId+'.zip'),{force:true});
  return {name:input.name,sha,projectId:preview.projectId};
 }finally{await rm(repo.dir,{recursive:true,force:true});}
}
export async function browseCode(a:Actor,input:{projectId:string;commit:string;path:string}){
 if(!/^[a-f0-9]{40}$/.test(input.commit))throw new Error('请选择固定代码版本');if(input.path)safeCodePath(input.path);
 const p=await codeProject(a,input.projectId),data=await get(p.api+'/contents/'+input.path.split('/').map(encodeURIComponent).join('/')+'?ref='+input.commit,true);
 if(Array.isArray(data))return {kind:'directory' as const,entries:data.map(f=>({name:String(f.name),path:String(f.path),type:f.type==='dir'?'directory':'file',size:Number(f.size||0)})),content:'',notice:''};
 if(data.type!=='file'||data.size>1024*1024)return {kind:'file' as const,entries:[],content:'',notice:'此文件不提供在线预览，可下载版本查看'};
 let content='';try{const bytes=Buffer.from(data.content||'','base64');content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(content.includes('\0'))throw 0;}catch{return {kind:'file' as const,entries:[],content:'',notice:'二进制文件不提供在线预览，可下载版本查看'};}
 return {kind:'file' as const,entries:[],content,notice:''};
}
export async function codeArchive(a:Actor,id:string,commit:string){
 if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('请选择固定代码版本');const p=await codeProject(a,id);
 const response=await readVersion(p.api+'/archive/'+commit+'.zip');
 if(!response.ok)throw new Error('版本下载暂时不可用，请稍后重试');return response;
}
