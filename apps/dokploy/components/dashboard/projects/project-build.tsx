import {CompatibilityCard} from './test-compatibility';
import {TestHandoff,ApplyTestVersion} from './test-handoff';
import {ProjectPreviewWorkbench} from './project-preview-workbench';
import {requestId} from '@/lib/request-id';
import {useState,useEffect} from 'react';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
const labels:Record<string,string>={queued:'等待准备',building:'正在准备',built:'正在准备',deploying:'正在启动',ready:'已准备好',failed:'未完成',cancelled:'已取消',interrupted:'已中断'};
export function ProjectBuild({projectId,commit}:{projectId:string;commit?:string}){
 const utils=api.useUtils();const [checking,setChecking]=useState(false);
 const [selected,setSelected]=useState(''),[error,setError]=useState(''),[selectedCommit,setSelectedCommit]=useState(commit||'');
 const versions=api.project.repositoryVersions.useQuery({projectId,page:1},{retry:false});
 const testCommit=selectedCommit||versions.data?.commits[0]?.sha||versions.data?.tags[0]?.sha||'';
 const compatibility=api.build.compatibility.useQuery({projectId,commit:testCommit},{enabled:!!testCommit,retry:false,staleTime:60000});
 const jobs=api.build.list.useQuery({projectId},{refetchInterval:5000});
 const environment=api.build.environment.useQuery({projectId},{refetchInterval:5000,retry:false});
 const status=api.build.status.useQuery({projectId},{refetchInterval:15000});
 const detail=api.build.detail.useQuery({id:selected},{enabled:!!selected,refetchInterval:5000});
 const credential=api.build.credential.useMutation({onError:e=>setError(e.message)});
 const start=api.build.start.useMutation({onSuccess:r=>{setSelected(r.id);void jobs.refetch();void environment.refetch();},onError:e=>setError(e.message)});
 const change=api.build.changeEnvironment.useMutation({onSuccess:()=>{credential.reset();void environment.refetch();},onError:e=>setError(e.message)});
 const cancel=api.build.cancel.useMutation({onSuccess:()=>{void jobs.refetch();void detail.refetch();},onError:e=>setError(e.message)});
 const runtime=api.build.runtimeLog.useQuery({id:selected},{enabled:false});
 const e=environment.data,p=detail.data,active=jobs.data?.find(j=>['queued','building','built','deploying'].includes(j.status)),busy=!!active||start.isPending||checking;
 const different=!!selectedCommit&&selectedCommit!==e?.commit;
 useEffect(()=>{setSelectedCommit(commit||'');},[projectId,commit]);
 useEffect(()=>{setSelected('');setError('');credential.reset();},[projectId]);
 useEffect(()=>{if(!selected&&jobs.data?.[0])setSelected(jobs.data[0].id);},[selected,jobs.data]);
 const stateText=busy?(labels[active?.status||'queued']||'正在准备'):({running:'测试应用运行中',stopped:'测试已停止',stopping:'正在停止',starting:'正在恢复测试',unhealthy:'应用暂时未就绪',absent:'还没有测试环境',deploying:'正在准备'}[e?.state||'']||'正在读取测试状态…');
 const run=async()=>{setError('');setChecking(true);try{let sha=selectedCommit;if(!sha){const latest=await versions.refetch();if(latest.error)throw latest.error;sha=latest.data?.commits[0]?.sha||latest.data?.tags[0]?.sha||'';}if(!sha)throw new Error('请先保存代码版本');const result=await utils.build.compatibility.fetch({projectId,commit:sha});if(!result.runnable)throw new Error('请先补齐下方测试配置；代码版本仍然保留');start.mutate({projectId,commit:sha,requestKey:requestId()});}catch(e){setError(e instanceof Error?e.message:'测试配置读取失败，请重试');}finally{setChecking(false);}};
 return <section className="space-y-4"><div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-3"><strong>当前是测试应用</strong><p className="text-sm mt-1">此处操作仅用于版本验证，测试数据与正式数据分开。正式上线需要提交申请，由管理员处理。</p></div>
 <div className="flex flex-wrap gap-3 items-center justify-between"><div><h2 className="text-lg font-semibold" role="status">{stateText}</h2><p className="text-sm text-muted-foreground">在项目工作区中预览应用、查看代码和版本。测试内容与已上线应用分开保存。</p></div><div className="flex flex-wrap gap-2">
 {(e?.state==='absent'||different)&&<Button disabled={busy||!status.data?.online||change.isPending||!compatibility.data?.runnable} onClick={run}>{busy?'正在准备…':different?'更新测试版本':'开始测试'}</Button>}
 {e?.desired===0&&e.state!=='absent'&&<Button disabled={busy||change.isPending||e.state==='stopping'} onClick={()=>change.mutate({projectId,action:'resume'})}>恢复测试</Button>}
 {e&&e.desired>0&&e.state!=='absent'&&<Button variant="outline" disabled={busy||change.isPending} onClick={()=>change.mutate({projectId,action:'stop'})}>停止测试</Button>}
 </div></div>
 {compatibility.data&&<CompatibilityCard data={compatibility.data}/>}
 {compatibility.isPending&&testCommit&&<p>正在检查版本测试配置…</p>}{compatibility.error&&<p role="alert" className="text-destructive">{compatibility.error.message}</p>}
 {different&&<p className="text-sm">已选择版本 <code translate="no">{selectedCommit.slice(0,12)}</code>。点击“更新测试版本”后自动准备；当前预览保持原运行版本。</p>}
 {(error||environment.error||jobs.error)&&<p role="alert" className="border rounded p-3 text-destructive">{error||environment.error?.message||jobs.error?.message}</p>}
 {busy&&<div className="rounded-xl bg-muted p-10 text-center space-y-3"><p className="font-medium">正在为你准备测试应用…</p><p>准备完成后自动显示预览，无需选择节点、端口或部署环境。</p>{active&&['queued','building','built'].includes(active.status)&&<Button variant="outline" disabled={cancel.isPending} onClick={()=>cancel.mutate({id:active.id})}>取消本次准备</Button>}</div>}
 {e?.state==='running'&&!busy&&<ProjectPreviewWorkbench key={projectId} projectId={projectId} buildId={e.buildId} activeCommit={e.commit} selectedCommit={selectedCommit} onSelectCommit={setSelectedCommit}/>}
 {e?.state==='stopped'&&!busy&&<div className="rounded-xl border p-10 text-center"><p>运行资源已释放，测试数据和账号已保留。</p><p className="text-sm text-muted-foreground mt-2">点击“恢复测试”即可继续，不需要重新准备代码。</p></div>}
 {e?.state==='absent'&&!busy&&<div className="rounded-xl border p-10 text-center"><p>点击“开始测试”，准备完成后应用会自动显示在项目预览中。</p>{!status.isPending&&!status.data?.online&&<p className="mt-2 text-destructive">测试准备服务暂时不可用，请管理员检查。</p>}</div>}
 <div className="flex gap-2 flex-wrap"><TestHandoff projectId={projectId}/><ApplyTestVersion projectId={projectId}/></div>
 <details className="rounded-lg border p-4"><summary className="cursor-pointer">版本与测试记录</summary><div className="mt-3 space-y-3"><Button variant="outline" disabled={busy||change.isPending||!status.data?.online||!compatibility.data?.runnable} onClick={run}>{selectedCommit?'重新测试所选版本':'测试最新代码'}</Button><p className="text-sm text-muted-foreground">只有点击此按钮才重新准备版本。进入页面和恢复已停止的测试不会重新构建。</p>{jobs.data?.map(j=><button key={j.id} className={`block w-full text-left border rounded p-3 ${selected===j.id?'border-primary':''}`} onClick={()=>{setSelected(j.id);credential.reset();}}>{labels[j.status]||j.status} · <code translate="no">{j.commit_sha.slice(0,12)}</code> · {new Date(j.created_at).toLocaleString('zh-CN')}</button>)}{p?.error&&<p role="alert" className="text-destructive">{p.error}</p>}{p&&<details><summary>诊断详情</summary><p className="text-sm">以下内容供排查使用，不需要用户手工操作。</p><pre className="bg-muted p-3 text-xs whitespace-pre-wrap max-h-80 overflow-auto">{p.log||'暂无记录'}</pre>{p.planId&&<><Button variant="outline" size="sm" onClick={()=>void runtime.refetch()}>读取应用日志</Button><pre className="text-xs whitespace-pre-wrap max-h-80 overflow-auto">{runtime.data?.log}</pre></>}</details>}</div></details>
 </section>;
}
