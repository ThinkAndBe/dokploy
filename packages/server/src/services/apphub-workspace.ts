import {latestHandoffs} from "./release-store";
import { db } from "@dokploy/server/db";
import { projects } from "@dokploy/server/db/schema";
import { findMemberByUserId } from "./permission";
import { and, desc, eq, inArray } from "drizzle-orm";

import { accessScope, safeAppUrl } from "./apphub-access";
export async function projectWorkspace(userId: string, organizationId: string) {
 const member=await findMemberByUserId(userId,organizationId), scope=accessScope(member);
 if (!scope.admin && member.accessedProjects.length===0) return [];
 const rows=await db.query.projects.findMany({
  where: and(eq(projects.organizationId,organizationId), scope.admin ? undefined : inArray(projects.projectId,member.accessedProjects)),
  columns:{projectId:true,name:true,description:true,giteaRepoStatus:true},orderBy:desc(projects.createdAt),
  with:{environments:{columns:{environmentId:true,name:true},with:{
   applications:{columns:{applicationId:true,name:true,applicationStatus:true},with:{domains:{columns:{host:true,https:true,path:true,enabled:true}},deployments:{columns:{title:true,status:true,createdAt:true},orderBy:(d,{desc})=>desc(d.createdAt),limit:1}}},
   compose:{columns:{composeId:true,name:true,composeStatus:true},with:{domains:{columns:{host:true,https:true,path:true,enabled:true}},deployments:{columns:{title:true,status:true,createdAt:true},orderBy:(d,{desc})=>desc(d.createdAt),limit:1}}}
  }}}
 });
 const released=process.env.APPHUB_RELEASE_POLICY_FILE?await latestHandoffs(organizationId):{};
 let urls:Record<string,unknown>={};
 try { const parsed=JSON.parse(process.env.APPHUB_SERVICE_URLS || "{}"); if(parsed && typeof parsed==='object' && !Array.isArray(parsed)) urls=parsed; } catch { /* Invalid optional links must not prevent viewing projects. */ }
 return rows.map(p=>({...p,environments:p.environments.filter(e=>scope.environment(e.environmentId)).map(e=>({environmentId:e.environmentId,name:e.name,services:[
  ...e.applications.map(s=>({...s,id:s.applicationId,type:"application" as const,status:s.applicationStatus})),
  ...e.compose.map(s=>({...s,id:s.composeId,type:"compose" as const,status:s.composeStatus}))
 ].filter(s=>scope.service(s.id)).map(s=>({id:s.id,name:s.name,type:s.type,status:s.status,latestDeployment:s.deployments[0]??null,
  url:safeAppUrl(released[s.id]?.loginUrl)??safeAppUrl(urls[s.id])??s.domains.filter(d=>d.enabled).map(d=>safeAppUrl(`${d.https?'https':'http'}://${d.host}${d.path||'/'}`)).find(Boolean)??null,
  path:`/dashboard/project/${encodeURIComponent(p.projectId)}/environment/${encodeURIComponent(e.environmentId)}/services/${s.type}/${encodeURIComponent(s.id)}`
 }))}))}));
}
