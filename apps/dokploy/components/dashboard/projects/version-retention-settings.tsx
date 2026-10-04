import {useState} from 'react';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
type Policy={keepVersions:number;keepDays:number;rollbackVersions:number;releaseDays:number};
export function VersionRetentionSettings({policy,revision,onSaved}:{policy:Policy;revision:number;onSaved:()=>void}){
 const [values,setValues]=useState(policy),[reason,setReason]=useState(''),[message,setMessage]=useState('');
 const save=api.project.saveVersionRetention.useMutation({onSuccess:()=>{setMessage('统一规则已保存。所有项目下次核验时生效，没有自动删除版本。');setReason('');onSaved();},onError:e=>setMessage(e.message)});
 return <details className="rounded border p-4 space-y-3"><summary className="cursor-pointer font-medium">管理员：统一保留规则</summary><p className="text-sm text-muted-foreground">适用于当前组织的所有项目。数量与天数满足任意一项即保留；使用中的版本始终保留。降低规则仅改变可删除范围，不会自动删除。</p><div className="grid md:grid-cols-2 gap-3">{([['keepVersions','最近代码版本数',1,1000],['keepDays','代码保留天数',1,3650],['rollbackVersions','正式回退版本数（不含当前）',2,100],['releaseDays','成功上线保留天数',1,3650]] as const).map(([key,label,min,max])=><label key={key} className="space-y-1 text-sm">{label}<Input aria-label={label} type="number" min={min} max={max} value={values[key]} onChange={e=>setValues({...values,[key]:Number(e.target.value)})}/></label>)}</div><label className="block text-sm space-y-1">调整原因<Textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} placeholder="说明调整范围和原因（至少5个字符）"/></label><Button size="sm" disabled={save.isPending||reason.trim().length<5||Object.values(values).some(v=>!Number.isInteger(v))} onClick={()=>save.mutate({policy:values,revision,reason})}>{save.isPending?'正在保存…':'保存统一规则'}</Button>{message&&<p role="status" className="text-sm">{message}</p>}</details>;
}
