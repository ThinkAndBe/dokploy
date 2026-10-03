import {withVersionLock,enforceVersion,nextVersion} from './version-governance';
import {commitChannel} from './version-number-policy';
import { giteaToken, repoSlug } from "./gitea-integration";

export function repositoryPath(projectId: string, repositoryUrl: string) {
 const u=new URL(repositoryUrl), base=new URL(process.env.GITEA_PUBLIC_URL || process.env.GITEA_API_URL || "http://unconfigured.invalid");
 const org=process.env.GITEA_DEFAULT_ORG||"apphub-apps", slug=repoSlug("",projectId);
 const expected=`${base.pathname.replace(/\/+$/,"")}/${org}/${slug}`;
 if(u.origin!==base.origin || u.username || u.password || u.pathname.replace(/\/+$/,"")!==expected || u.search || u.hash) throw new Error("仓库关联需要运维核查");
 return `${(process.env.GITEA_API_URL||base.href).replace(/\/+$/,"")}/api/v1/repos/${encodeURIComponent(org)}/${encodeURIComponent(slug)}`;
}
export async function repositoryVersions(projectId:string,repositoryUrl:string,page:number,organizationId?:string) {
 const base=repositoryPath(projectId,repositoryUrl);
 async function get(route:string) {
  const r=await fetch(`${base}/${route}?limit=20&page=${page}`,{headers:{Authorization:`token ${giteaToken()}`},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(r.status===409) return [];
  if(!r.ok) throw new Error("暂时无法读取版本记录，请稍后重试或联系运维");
  const data:unknown=await r.json(); if(!Array.isArray(data))throw new Error("版本服务返回了无法识别的数据");return data;
 }
 const [tags,commits]=await Promise.all([get("tags"),get("commits")]);
 const removed=organizationId?await (await import('./version-recycle')).recycledNames(organizationId,projectId):new Set<string>();
 const {commitActor,commitPresentation}=await import('./user-name-policy');
 const bySha=new Map(commits.map(c=>[String(c.sha),c]));
 await Promise.all([...new Set(tags.map(t=>String(t.commit?.sha||t.id||'')))].filter(sha=>/^[a-f0-9]{40}$/.test(sha)&&!bySha.has(sha)).map(async sha=>{const r=await fetch(`${base}/git/commits/${sha}`,{headers:{Authorization:`token ${giteaToken()}`},redirect:'error',signal:AbortSignal.timeout(10000)});if(r.ok){const c=await r.json();bySha.set(sha,{sha,commit:c});}}));
 const actorIds=[...bySha.values()].map(c=>commitActor(String(c.commit?.message||'')));
 const names=organizationId&&actorIds.some(Boolean)?await (await import('./user-names')).userNames(organizationId,actorIds):new Map<string,string>();
 return {page,next:await nextVersion(base,organizationId,projectId),hasMore:tags.length===20||commits.length===20,
 tags:tags.filter(t=>!removed.has(String(t.name||''))).map(t=>{const sha=String(t.commit?.sha||t.id||''),c=bySha.get(sha)?.commit;const display=commitPresentation(String(c?.message||''),String(c?.author?.name||'历史记录未提供'),names);return {name:String(t.name||''),sha,author:display.author,date:String(c?.author?.date||''),description:display.message.replace(/^版本 [^\n]*\n*/, '').slice(0,2000),source:commitChannel(String(c?.message||''))};}),
 commits:commits.map(c=>({sha:String(c.sha||""),...(()=>{const display=commitPresentation(String(c.commit?.message||""),String(c.commit?.author?.name||""),names);return {...display,message:display.message.slice(0,2000)};})(),source:commitChannel(String(c.commit?.message||"")),date:String(c.commit?.author?.date||"")}))};
}

// Create an immutable name for an existing commit. Never overwrite or delete a tag.
export async function createRepositoryVersion(projectId:string,repositoryUrl:string,name:string,commit:string,description:string,organizationId?:string){return withVersionLock(projectId,()=>createRepositoryVersionLocked(projectId,repositoryUrl,name,commit,description,organizationId));}
async function createRepositoryVersionLocked(projectId:string,repositoryUrl:string,name:string,commit:string,description:string,organizationId?:string){
 const base=repositoryPath(projectId,repositoryUrl);
 const headers={Authorization:`token ${giteaToken()}`,'Content-Type':'application/json'};
 const source=await fetch(`${base}/git/commits/${encodeURIComponent(commit)}`,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!source.ok)throw new Error('代码提交不存在或无法读取，请刷新版本记录后重试');
 const sourceData=await source.json();if(sourceData.sha!==commit)throw new Error('代码提交校验失败');
 const existing=await fetch(`${base}/tags/${encodeURIComponent(name)}`,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(existing.ok){const data=await existing.json();if(data.commit?.sha===commit)return {name,sha:commit,created:false};throw new Error('版本名称已关联其他代码，请使用新的版本号');}
 if(existing.status!==404)throw new Error('暂时无法核对版本名称，请稍后重试');
 await enforceVersion(base,name,organizationId,projectId);
 const result=await fetch(`${base}/tags`,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(15000),body:JSON.stringify({tag_name:name,target:commit,message:description})});
 if(!result.ok)throw new Error('版本未能创建，请刷新记录核对后重试；已有版本不会被覆盖');
 const data=await result.json();if(data.commit?.sha!==commit)throw new Error('版本已提交但核验失败，请刷新记录核查');
 return {name,sha:commit,created:true};
}
