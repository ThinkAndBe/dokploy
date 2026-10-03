import Link from 'next/link';
import {useState} from 'react';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
export function ProjectSharing({projectId}:{projectId:string}){
 const [open,setOpen]=useState(false),[userId,setUserId]=useState(''),[keep,setKeep]=useState(false),[error,setError]=useState('');
 const q=api.project.sharing.useQuery({projectId},{enabled:open});const utils=api.useUtils();
 const change=api.project.changeSharing.useMutation({onSuccess:()=>{setError('');setUserId('');void q.refetch();void utils.project.workspace.invalidate();},onError:e=>setError(e.message)});
 function act(action:'grant'|'revoke'|'transfer',target=userId){if(action==='transfer'&&!window.confirm('确认移交项目负责人？'+(keep?'原负责人保留协作权限。':'原负责人将失去本项目授权；平台管理员仍保留运维权限。')))return;change.mutate({projectId,userId:target,action,keepPrevious:keep});}
 return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" size="sm">项目共创</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>项目共创 · 成员与权限</DialogTitle></DialogHeader>
 <p className="text-sm text-muted-foreground">邀请同事共同开发，协作者使用自己的账号和 AI 接入，不共享负责人的密钥。操作受各自角色限制，正式上线由管理员处理。</p>
 {(error||q.error)&&<p role="alert" className="text-destructive">{error||q.error?.message}</p>}
 {q.isPending?<p>正在读取成员…</p>:<><div className="max-h-60 overflow-auto space-y-2">{q.data?.members.map(m=><div key={m.id} className="flex justify-between gap-2 border-b py-2"><div>{m.name} · {m.role}<p className="text-xs text-muted-foreground">{m.email}</p></div>{q.data.canManage&&m.id!==q.data.ownerId&&<Button size="sm" variant="outline" disabled={change.isPending} onClick={()=>{if(window.confirm('确认撤销此用户的项目访问权限？'))act('revoke',m.id);}}>撤销授权</Button>}</div>)}</div>
 {q.data?.isOwner?<p className="rounded bg-muted p-3 text-sm">你是项目负责人，日常开发直接使用工作台中的个人 AI 接入即可；这里用于邀请协作者和管理项目权限。</p>:q.data&&<div className="rounded bg-muted p-3 space-y-2"><p className="text-sm">使用你自己的 AI 配置参与项目。撤销项目授权后，网页和 AI 都将失去访问权限。</p><Button asChild variant="outline"><Link href={{pathname:'/dashboard/mcp',query:{projectId}}}>连接我的 AI</Link></Button></div>}
 {!q.data?.ownerId&&<p className="text-sm">此项目尚未指定负责人，请管理员选择用户并移交。</p>}
 {q.data?.canManage&&<div className="space-y-3"><label className="block">选择同组织用户<select className="border rounded p-2 w-full bg-background" value={userId} onChange={e=>setUserId(e.target.value)}><option value="">请选择</option>{q.data.candidates.map(m=><option key={m.id} value={m.id}>{m.name}（{m.email}）</option>)}</select></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={keep} onChange={e=>setKeep(e.target.checked)}/>移交后保留原负责人为协作者</label><div className="flex gap-2"><Button disabled={!userId||change.isPending} onClick={()=>act('grant')}>添加协作者</Button><Button variant="outline" disabled={!userId||change.isPending||userId===q.data.ownerId} onClick={()=>act('transfer')}>移交负责人</Button></div></div>}</>}
 <section className="border-t pt-3 space-y-2"><h3 className="font-semibold">共创成员操作记录</h3><div className="max-h-40 overflow-auto space-y-2">{q.data?.activity.map((e,i)=><p key={i} className="text-sm">{e.actor} · {e.action==='grant'?'添加协作者':e.action==='revoke'?'撤销项目授权':e.action==='transfer:keep_previous'?'移交负责人（原负责人保留协作）':'移交负责人（原负责人退出）'} · {e.target}<span className="block text-xs text-muted-foreground">{new Date(e.date).toLocaleString('zh-CN')}</span></p>)}{q.data&&!q.data.activity.length&&<p className="text-sm text-muted-foreground">暂无已记录的成员变更。代码贡献请在“代码与版本”查看。</p>}</div></section>
 </DialogContent></Dialog>;
}
