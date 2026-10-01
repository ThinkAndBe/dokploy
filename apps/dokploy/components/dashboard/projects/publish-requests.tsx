import {useState} from 'react';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
const labels:Record<string,string>={pending:'待管理员处理',processing:'管理员处理中',rejected:'已退回',awaiting_approval:'待发布审批',queued:'等待发布',deploying:'正在发布',deployed:'已发布',failed:'发布失败',needs_review:'管理员核查中',cancelled:'已取消'};
export function PublishRequests({admin,onPrepare,projectId}:{projectId?:string;admin:boolean;onPrepare:(testedId:string,projectId:string)=>void}){
 const q=api.release.publishRequests.useQuery(undefined,{refetchInterval:10000});const [error,setError]=useState('');
 const review=api.release.reviewPublish.useMutation({onSuccess:()=>void q.refetch(),onError:e=>setError(e.message)});
 const rows=q.data?.filter(r=>!projectId||r.project_id===projectId);
 return <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">{admin?'待处理上线申请':'上线申请进度'}</h2>{(error||q.error)&&<p role="alert">{error||q.error?.message}</p>}{!rows?.length&&<p className="text-muted-foreground">暂无上线申请。完成测试后，在版本详情中提交。</p>}{rows?.map(r=><div className="border rounded p-4 space-y-2" key={r.id}><strong>{r.project_name} · {r.tested_title}</strong><p className="text-sm">{labels[r.release_status||r.status]||r.status} · 申请人：{r.applicant_name}</p><p className="text-sm">{r.description}</p>{r.review_note&&<p className="text-sm">管理员回复：{r.review_note}</p>}{admin&&!r.release_status&&r.status!=='rejected'&&<div className="flex gap-2"><Button size="sm" onClick={()=>{if(r.status==='pending')review.mutate({id:r.id,status:'processing',note:'管理员已接手准备发布方案'});onPrepare(r.tested_plan_id,r.project_id);}}>处理发布</Button>{r.status==='pending'&&<Button variant="outline" size="sm" disabled={review.isPending} onClick={()=>{const note=window.prompt('请填写退回原因');if(note?.trim())review.mutate({id:r.id,status:'rejected',note:note.trim()});}}>退回申请</Button>}</div>}</div>)}</section>;
}
