import { giteaToken, repoSlug } from "./gitea-integration";

export function repositoryPath(projectId: string, repositoryUrl: string) {
 const u=new URL(repositoryUrl), base=new URL(process.env.GITEA_PUBLIC_URL || process.env.GITEA_API_URL || "http://unconfigured.invalid");
 const org=process.env.GITEA_DEFAULT_ORG||"apphub-apps", slug=repoSlug("",projectId);
 const expected=`${base.pathname.replace(/\/+$/,"")}/${org}/${slug}`;
 if(u.origin!==base.origin || u.username || u.password || u.pathname.replace(/\/+$/,"")!==expected || u.search || u.hash) throw new Error("仓库关联需要运维核查");
 return `${(process.env.GITEA_API_URL||base.href).replace(/\/+$/,"")}/api/v1/repos/${encodeURIComponent(org)}/${encodeURIComponent(slug)}`;
}
export async function repositoryVersions(projectId:string,repositoryUrl:string,page:number) {
 const base=repositoryPath(projectId,repositoryUrl);
 async function get(route:string) {
  const r=await fetch(`${base}/${route}?limit=20&page=${page}`,{headers:{Authorization:`token ${giteaToken()}`},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(r.status===409) return [];
  if(!r.ok) throw new Error("暂时无法读取版本记录，请稍后重试或联系运维");
  const data:unknown=await r.json(); if(!Array.isArray(data))throw new Error("版本服务返回了无法识别的数据");return data;
 }
 const [tags,commits]=await Promise.all([get("tags"),get("commits")]);
 return {page,hasMore:tags.length===20||commits.length===20,
 tags:tags.map(t=>({name:String(t.name||""),sha:String(t.commit?.sha||t.id||"")})),
 commits:commits.map(c=>({sha:String(c.sha||""),message:String(c.commit?.message||"").slice(0,2000),author:String(c.commit?.author?.name||""),date:String(c.commit?.author?.date||"")}))};
}
