import {useState} from 'react';
import {toast} from 'sonner';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogTrigger} from '@/components/ui/dialog';
import {projectProfileInput} from '@dokploy/server/services/project-profile-policy';
type Profile={projectId:string;name:string;description:string|null;canEdit:boolean};
function ProfileForm({profile,onSaved}:{profile:Profile;onSaved:()=>void}){
 const [name,setName]=useState(profile.name),[description,setDescription]=useState(profile.description??''),[error,setError]=useState('');
 const utils=api.useUtils();
 const save=api.project.updateProfile.useMutation({onSuccess:async()=>{
  await Promise.all([utils.project.workspace.invalidate(),utils.project.profile.invalidate({projectId:profile.projectId}),utils.project.one.invalidate({projectId:profile.projectId}),utils.project.all.invalidate()]);
  toast.success('项目资料已保存');onSaved();
 },onError:e=>setError(e.message)});
 const damaged=name.includes('\uFFFD')||description.includes('\uFFFD');
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();setError('');const result=projectProfileInput.safeParse({projectId:profile.projectId,name,description,expected:{name:profile.name,description:profile.description}});if(!result.success){setError(result.error.issues[0]?.message||'请检查项目资料');return;}save.mutate(result.data);}}>
 <label className="block space-y-2"><span>项目名称</span><Input aria-label="项目名称" value={name} maxLength={100} disabled={save.isPending||!profile.canEdit} onChange={e=>setName(e.target.value)}/></label>
 <label className="block space-y-2"><span>项目说明</span><Textarea aria-label="项目说明" value={description} rows={6} maxLength={2000} disabled={save.isPending||!profile.canEdit} onChange={e=>setDescription(e.target.value)} placeholder="说明项目用途、来源及当前进展"/><span className="block text-xs text-muted-foreground">{description.length} / 2000 字，支持中文和换行。</span></label>
 {damaged&&<p className="text-sm text-amber-700">原文包含损坏字符，请重新填写正确文字后保存。无法从损坏字符还原原文。</p>}
 {error&&<p role="alert" className="text-destructive">{error}</p>}
 {profile.canEdit?<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={onSaved}>取消</Button><Button type="submit" disabled={save.isPending||damaged}>{save.isPending?'正在保存…':'保存项目资料'}</Button></div>:<p>当前为只读成员，不能修改项目资料。</p>}
 </form>;
}
export function ProjectProfile({projectId}:{projectId:string}){
 const [open,setOpen]=useState(false);
 const role=api.rbac.me.useQuery();
 const q=api.project.profile.useQuery({projectId},{enabled:open,staleTime:0,retry:false,refetchOnWindowFocus:false});
 if(!role.data||role.data.role==='viewer')return null;
 return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" size="sm">编辑项目资料</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>编辑项目资料</DialogTitle><DialogDescription>修改项目名称与说明，保存后立即显示，不需要重新上传代码或部署应用。</DialogDescription></DialogHeader>{q.isPending||q.isFetching?<p>正在读取项目资料…</p>:q.error?<p role="alert">{q.error.message}</p>:q.data&&<ProfileForm profile={q.data} onSaved={()=>setOpen(false)}/>}</DialogContent></Dialog>;
}
