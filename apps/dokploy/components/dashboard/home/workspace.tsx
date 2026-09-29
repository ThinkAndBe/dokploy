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
 const q=api.project.workspace.useQuery(undefined,{refetchInterval:15000});
 const {data:auth}=api.user.get.useQuery(),{data:permissions}=api.user.getPermissions.useQuery();
 const [search,setSearch]=useState('');const admin=auth?.role==='owner'||auth?.role==='admin';
 const rows=q.data?.filter(p=>(p.name+' '+(p.description||'')).toLowerCase().includes(search.toLowerCase()))??[];
 return <main className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto w-full">
 <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-semibold">我的项目</h1><p className="text-muted-foreground mt-2">管理版本 → 沙箱测试 → 申请上线。测试直接执行，上线由管理员处理。</p></div><div className="flex items-center gap-2">{permissions?.project.create&&<HandleProject/>}{admin&&<Button variant="outline" asChild><Link href="/dashboard/home?view=operations">管理后台</Link></Button>}</div></header>
 <div className="flex items-center gap-3"><Input aria-label="搜索我的项目" placeholder="搜索项目" value={search} onChange={e=>setSearch(e.target.value)} className="max-w-md"/><Button variant="outline" onClick={()=>void q.refetch()} disabled={q.isFetching}>刷新</Button></div>
 {q.isPending?<p>正在加载项目…</p>:q.error?<p role="alert">暂时无法读取项目，请刷新重试。</p>:rows.length===0?<div className="rounded-xl border p-10 text-center"><h2>暂无项目</h2><p className="text-muted-foreground mt-2">创建一个项目开始，或请项目负责人邀请你加入。</p></div>:rows.map(p=>{
 const services=p.environments.flatMap(e=>e.services);
 return <section className="rounded-xl border bg-card" key={p.projectId}><div className="p-6 space-y-4"><div><h2 className="text-xl font-semibold" translate="no">{p.name}</h2>{p.description&&<p className="text-sm text-muted-foreground mt-1" translate="no">{p.description}</p>}</div>
 <div className="flex flex-wrap gap-2"><ProjectVersions projectId={p.projectId}/><Button size="sm" asChild><Link href={`/dashboard/releases?projectId=${p.projectId}`}>开始测试</Link></Button><Button size="sm" variant="outline" asChild><Link href={`/dashboard/releases?projectId=${p.projectId}&intent=publish`}>申请上线</Link></Button><ProjectSharing projectId={p.projectId}/></div>
 {services.length===0?<p className="text-sm text-muted-foreground">还没有部署记录。从版本管理开始，准备好后进行测试。</p>:<div className="space-y-2">{services.map(s=><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4" key={s.id}><div><p className="font-medium" translate="no">{s.name}</p><p className={`text-sm mt-1 ${s.status==='error'?'text-destructive':'text-muted-foreground'}`}>{statusText[s.status]||'状态待确认'}</p></div><div className="flex flex-wrap gap-2">{s.url?<Button size="sm" asChild><a href={s.url} target="_blank" rel="noopener noreferrer">打开应用</a></Button>:<span className="text-sm text-muted-foreground self-center">访问地址尚未登记</span>}<ServiceHandoff serviceId={s.id}/></div></div>)}</div>}
 </div></section>})}
 </main>;
}
