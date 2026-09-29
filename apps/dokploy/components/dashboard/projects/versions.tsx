import { useState } from "react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger } from "@/components/ui/dialog";
export function ProjectVersions({projectId}:{projectId:string}) {
 const [open,setOpen]=useState(false),[page,setPage]=useState(1);
 const q=api.project.repositoryVersions.useQuery({projectId,page},{enabled:open,retry:false});
 return <Dialog open={open} onOpenChange={v=>{setOpen(v);if(v)setPage(1)}}><DialogTrigger asChild><Button variant="outline" size="sm">版本记录</Button></DialogTrigger><DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>项目版本记录</DialogTitle><DialogDescription>直接查看已归档的代码版本。代码提交不等于部署成功，实际运行情况请查看部署记录。</DialogDescription></DialogHeader>
 {q.isPending?<p>正在读取版本记录…</p>:q.error?<div role="alert"><p>{q.error.message}</p><Button onClick={()=>void q.refetch()}>重试</Button></div>:<>
 <h3 className="font-semibold">版本标签</h3><div className="flex flex-wrap gap-2" translate="no">{q.data.tags.length?q.data.tags.map(t=><span key={t.name} className="rounded border px-3 py-1">{t.name} <code>{t.sha.slice(0,8)}</code></span>):<p>本页没有版本标签</p>}</div>
 <h3 className="font-semibold mt-4">代码提交</h3>{q.data.commits.length?q.data.commits.map(c=><div className="border-b py-3" key={c.sha} translate="no"><p className="whitespace-pre-wrap break-words">{c.message}</p><p className="text-xs text-muted-foreground mt-1"><code>{c.sha.slice(0,12)}</code> · {c.author} · {c.date?new Date(c.date).toLocaleString('zh-CN'):''}</p></div>):<p>暂无提交记录，上传代码后会在这里保留历史。</p>}
 <div className="flex justify-between items-center"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>上一页</Button><span>第 {page} 页 · 每页最多 20 条</span><Button variant="outline" disabled={!q.data.hasMore} onClick={()=>setPage(page+1)}>下一页</Button></div></>}
 </DialogContent></Dialog>;
}
