import {ProjectRuntimeSummary} from '../projects/project-runtime-summary';
import {StartProjectTest} from '@/components/dashboard/projects/start-project-test';
import { ProjectSharing } from '../projects/sharing';
import { ServiceHandoff } from '../projects/handoff';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HandleProject } from '../projects/handle-project';
import { ProjectVersions } from '../projects/versions';
const statusText:Record<string,string>={done:'最近部署成功',running:'正在部署',error:'部署失败',idle:'尚未部署',cancelled:'已取消'};
export function AppHubWorkspace(){
 const role=api.rbac.me.useQuery();
 const q=api.project.workspace.useQuery(undefined,{refetchInterval:15000});
 const {data:auth}=api.user.get.useQuery(),{data:permissions}=api.user.getPermissions.useQuery();
 const [search,setSearch]=useState('');const admin=auth?.role==='owner'||auth?.role==='admin';
 const rows=q.data?.filter(p=>(p.name+' '+(p.description||'')).toLowerCase().includes(search.toLowerCase()))??[];
 return <main className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto w-full">
 <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-semibold">我的项目</h1><p className="text-muted-foreground mt-2">上传代码 → 保存版本 → 沙箱测试 → 申请上线。测试直接执行，上线由管理员处理。</p></div><div className="flex items-center gap-2">{role.data?.role!=='viewer'&&permissions?.project.create&&<HandleProject/>}{admin&&<Button variant="outline" asChild><Link href="/dashboard/home?view=operations">管理后台</Link></Button>}</div></header>
 {role.data?.role==='viewer'&&<p className="border rounded p-3">当前为只读成员：可查看已授权项目和打开测试，不能上传版本、修改测试或申请上线。</p>}
 <div className="flex items-center gap-3"><Input aria-label="搜索我的项目" placeholder="搜索项目" value={search} onChange={e=>setSearch(e.target.value)} className="max-w-md"/><Button variant="outline" onClick={()=>void q.refetch()} disabled={q.isFetching}>刷新</Button></div>
 {q.isPending?<p>正在加载项目…</p>:q.error?<p role="alert">暂时无法读取项目，请刷新重试。</p>:rows.length===0?<div className="rounded-xl border p-10 text-center"><h2>暂无项目</h2><p className="text-muted-foreground mt-2">创建一个项目开始，或请项目负责人邀请你加入。</p></div>:rows.map(p=>{
 const services=p.environments.filter(e=>!e.environmentId.startsWith("build-")).flatMap(e=>e.services);
 return <section className="rounded-xl border bg-card" key={p.projectId}><div className="p-6 space-y-4"><div><h2 className="text-xl font-semibold" translate="no">{p.name}</h2>{p.description&&<p className="text-sm text-muted-foreground mt-1" translate="no">{p.description}</p>}</div>
 <div className="flex flex-wrap gap-2"><ProjectVersions projectId={p.projectId}/><ProjectSharing projectId={p.projectId}/></div>
 <ProjectRuntimeSummary projectId={p.projectId}/>
 </div></section>})}
 </main>;
}
