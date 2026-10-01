import {TestHandoff,ApplyTestVersion} from './test-handoff';
import Link from 'next/link';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
import {StartProjectTest} from './start-project-test';
import {ServiceHandoff} from './handoff';
export function ProjectRuntimeSummary({projectId}:{projectId:string}){
 const q=api.projectOperations.summary.useQuery({projectId},{refetchInterval:30000,retry:false});
 return <div className="space-y-3">{q.error?<p role="alert">项目运行状态读取失败，请刷新重试。</p>:<div className="grid md:grid-cols-2 gap-4">
 <section className="rounded-xl border-2 border-amber-300 bg-amber-50/50 dark:bg-amber-950/10 p-4 space-y-3"><h3 className="font-semibold text-amber-800 dark:text-amber-200">测试应用 · 仅供验证</h3><p className="text-sm">在这里检查新版本，不会替换正式应用。测试数据与正式数据分别保存。</p><p className="text-sm">{q.isPending?'正在读取状态…':q.data?.resources.some(r=>r.tier==='test'&&r.state==='running')?'测试应用正在运行':q.data?.resources.some(r=>r.tier==='test'&&r.state==='stopped')?'测试已停止，可恢复':'尚未运行或正在准备'}</p><div className="flex gap-2 flex-wrap"><StartProjectTest projectId={projectId}/><TestHandoff projectId={projectId}/><ApplyTestVersion projectId={projectId}/></div></section>
 <section className="rounded-xl border-2 border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/10 p-4 space-y-3"><h3 className="font-semibold text-emerald-800 dark:text-emerald-200">正式应用 · 业务使用</h3><p className="text-sm">经管理员上线后供业务使用。更新正式应用需要提交上线申请。</p>{q.isPending?<p>正在读取状态…</p>:!q.data?.resources.some(r=>r.tier==='formal'&&!r.database)?<p className="text-sm">尚未登记正式应用。</p>:q.data.resources.filter(r=>r.tier==='formal'&&!r.database).map(r=><div className="space-y-2" key={r.key}><p className="text-sm">{r.name} · {r.state==='running'?'运行中':r.state==='stopped'?'已停止':r.state==='missing'?'尚未部署':'启动中或异常，请管理员核查'}</p><div className="flex flex-wrap gap-2">{r.url&&r.state==='running'&&<Button size="sm" asChild><a href={r.url} target="_blank" rel="noopener noreferrer">打开正式应用</a></Button>}{r.composeId&&r.canReadHandoff&&<ServiceHandoff serviceId={r.composeId}/>}</div></div>)}</section>
 </div>}{q.data?.resources.some(r=>r.tier==='unknown')&&<p className="text-sm text-amber-700">另有资源尚未登记为测试或正式用途，请管理员核对关联。</p>}{q.data?.admin&&<Button size="sm" variant="outline" asChild><Link href={`/dashboard/project-operations?projectId=${projectId}`}>管理员：运行、数据库与备份</Link></Button>}</div>;
}
