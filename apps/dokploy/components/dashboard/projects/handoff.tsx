import {useState,useEffect} from 'react';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogTrigger,DialogDescription} from '@/components/ui/dialog';

export function ServiceHandoff({serviceId}:{serviceId:string}){
 const [open,setOpen]=useState(false),[password,setPassword]=useState('');
 const query=api.project.serviceHandoff.useQuery({serviceId},{enabled:open,staleTime:0});
 const reveal=api.project.revealServiceCredential.useMutation({onSuccess:data=>setPassword(data.password)});
 useEffect(()=>{if(!open){setPassword('');reveal.reset();}},[open]);
 useEffect(()=>{if(!password)return;const timer=setTimeout(()=>{setPassword('');reveal.reset();},30000);return()=>clearTimeout(timer);},[password]);
 const h=query.data?.handoff;
 return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">使用与配置说明</Button></DialogTrigger><DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>使用与配置说明</DialogTitle><DialogDescription>部署后从这里查看应用入口、登录方式和关键配置。应用账号与 AppHub 账号分别管理。</DialogDescription></DialogHeader>
 {query.isPending?<p>正在读取交付说明…</p>:query.error?<p role="alert">无法读取，请刷新重试或联系运维。</p>:!h?<p>这个应用尚未登记使用说明，请运维补齐访问地址、登录方式、账号和关键配置。</p>:<div className="space-y-4"><h3 className="font-semibold" translate="no">{h.title}</h3><dl className="grid grid-cols-[7rem_1fr] gap-3 text-sm"><dt>登录地址</dt><dd className="break-all">{h.loginUrl?<a className="text-primary underline" href={h.loginUrl} target="_blank" rel="noopener noreferrer" translate="no">{h.loginUrl}</a>:'尚未登记'}</dd><dt>登录方式</dt><dd>{h.loginMethod||'尚未登记'}</dd><dt>初始账号</dt><dd translate="no">{h.account||'尚未登记'}</dd><dt>密码领取</dt><dd>{h.credentialHint||'请联系运维领取应用凭据'}</dd></dl>
 {query.data?.canRevealCredential&&<div className="rounded border p-3 space-y-2"><p className="text-xs text-muted-foreground">仅平台管理员可查看已登记的初始密码；查看会留记录，30 秒后自动隐藏。应用内修改密码后需更新交付凭据。</p><Button size="sm" variant="outline" disabled={reveal.isPending} onClick={()=>password?setPassword(''):reveal.mutate({serviceId})}>{password?'隐藏密码':reveal.isPending?'正在读取…':'查看初始密码'}</Button>{password&&<p className="font-mono select-all break-all" translate="no">{password}</p>}{reveal.error&&<p role="alert">凭据尚未登记或暂时无法读取，请联系运维。</p>}</div>}
 {h.settings.length>0&&<div><h4 className="font-semibold mb-2">关键配置</h4><dl className="grid grid-cols-[7rem_1fr] gap-3 text-sm">{h.settings.map((r,i)=><div key={i} className="contents"><dt>{r.label}</dt><dd className="break-words" translate="no">{r.value}</dd></div>)}</dl></div>}{h.notes.length>0&&<ul className="list-disc pl-5 text-sm space-y-2">{h.notes.map((n,i)=><li key={i}>{n}</li>)}</ul>}<p className="text-xs text-muted-foreground">说明更新时间：{h.updatedAt||'未记录'}。此处为交付说明，实际运行状态请查看部署记录。</p></div>}
 </DialogContent></Dialog>;
}
