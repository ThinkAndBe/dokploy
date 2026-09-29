import {useState} from 'react';
import Link from 'next/link';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
export function ProjectVersions({projectId}:{projectId:string}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[commit,setCommit]=useState(''),[name,setName]=useState(''),[description,setDescription]=useState('');
 const q=api.project.repositoryVersions.useQuery({projectId,page},{enabled:open,retry:false});
 const create=api.project.createVersion.useMutation({onSuccess:()=>{setName('');setCommit('');setDescription('');void q.refetch();}});
 const test=(sha:string)=><Button size="sm" variant="outline" asChild><Link href={`/dashboard/releases?projectId=${encodeURIComponent(projectId)}&commit=${encodeURIComponent(sha)}`} onClick={()=>setOpen(false)}>测试此版本</Link></Button>;
 return <Dialog open={open} onOpenChange={v=>{setOpen(v);if(v)setPage(1);}}><DialogTrigger asChild><Button variant="outline" size="sm">版本管理</Button></DialogTrigger><DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>版本管理</DialogTitle><DialogDescription>为已提交的代码建立版本，再测试此版本。保存版本不会触发上线。</DialogDescription></DialogHeader><Link className="text-primary text-sm underline" href="/dashboard/version-api">查看版本管理接口与接入说明</Link>
 {q.isPending?<p>正在读取版本…</p>:q.error?<div role="alert"><p>{q.error.message}</p><Button onClick={()=>void q.refetch()}>重试</Button></div>:<><h3 className="font-semibold">已保存的版本</h3>{q.data.tags.length?q.data.tags.map(t=><div key={t.name} className="flex justify-between gap-3 items-center rounded border p-3"><div translate="no">{t.name} <code className="text-muted-foreground text-xs">{t.sha.slice(0,12)}</code></div>{test(t.sha)}</div>):<p className="text-muted-foreground">暂无版本，从下面的代码提交建立第一个版本。</p>}
 <h3 className="font-semibold mt-3">代码提交</h3>{q.data.commits.length?q.data.commits.map(c=><div key={c.sha} className="border-b py-3 space-y-2"><p className="whitespace-pre-wrap break-words" translate="no">{c.message}</p><p className="text-xs text-muted-foreground" translate="no">{c.sha.slice(0,12)} · {c.author} · {c.date?new Date(c.date).toLocaleString('zh-CN'):''}</p><Button size="sm" variant="outline" onClick={()=>{setCommit(c.sha);create.reset();}}>建立版本</Button></div>):<p>暂无代码提交。请先通过获授权的 Git 仓库提交代码。</p>}
 {commit&&<section className="border rounded p-4 space-y-3"><p className="text-sm">所选代码：<code>{commit.slice(0,12)}</code></p><label className="block">版本号<Input value={name} onChange={e=>setName(e.target.value)} placeholder="例如 v1.2.0"/></label><label className="block">版本说明<Input value={description} onChange={e=>setDescription(e.target.value)} maxLength={2000}/></label><p className="text-xs text-muted-foreground">版本号使用字母、数字、点、横线或下划线，保存后不会覆盖已有版本。</p><Button disabled={!name||create.isPending} onClick={()=>create.mutate({projectId,commit,name,description})}>保存版本</Button></section>}
 {create.error&&<p role="alert" className="text-destructive">{create.error.message}</p>}{create.isSuccess&&<p role="status">版本已保存。</p>}
 <div className="flex justify-between items-center"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>上一页</Button><span>第 {page} 页</span><Button variant="outline" disabled={!q.data.hasMore} onClick={()=>setPage(page+1)}>下一页</Button></div></>}
 </DialogContent></Dialog>;
}
