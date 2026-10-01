import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Code2,Eye,History,Monitor,Smartphone,RefreshCw,ExternalLink,Maximize2,Minimize2,Download} from 'lucide-react';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {previewPath} from '@/lib/preview-navigation';

type Props={projectId:string;buildId?:string|null;activeCommit?:string|null;selectedCommit:string;onSelectCommit:(sha:string)=>void};
export function ProjectPreviewWorkbench({projectId,buildId,activeCommit,selectedCommit,onSelectCommit}:Props){
 const [view,setView]=useState<'preview'|'code'|'history'>('preview');
 const [mobile,setMobile]=useState(false),[wide,setWide]=useState(false);
 const [path,setPath]=useState('/'),[draft,setDraft]=useState('/'),[filePath,setFilePath]=useState('');
 const [source,setSource]=useState(''),[origin,setOrigin]=useState(''),[revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[slow,setSlow]=useState(false);
 const request=useRef(0),renewRef=useRef<()=>void>(()=>{});
 const grant=api.build.preview.useMutation();
 const runtime=api.build.environment.useQuery({projectId},{retry:false});
 const external=runtime.data?.externalPreview===true;
 const launchHref='/dashboard/preview-open?projectId='+encodeURIComponent(projectId);
 const versions=api.project.repositoryVersions.useQuery({projectId,page:1},{retry:false});
 const codeCommit=selectedCommit||activeCommit||versions.data?.commits[0]?.sha||'';
 const files=api.project.browseCode.useQuery({projectId,commit:codeCommit,path:filePath},{enabled:view==='code'&&!!codeCommit,retry:false});
 const name=(sha:string|null|undefined)=>versions.data?.tags.find(t=>t.sha===sha)?.name||sha?.slice(0,12)||'尚无版本';

 async function connect(){
  const generation=++request.current;setLoading(true);setError('');setSource('');setOrigin('');setPath('/');setDraft('/');
  try{
   const g=await grant.mutateAsync({projectId});
   await fetch(g.origin+'/',{mode:'no-cors',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(generation!==request.current)return;
   setOrigin(g.origin);setSource(g.url);setRevision(r=>r+1);
  }catch(e){if(generation===request.current){setLoading(false);setError(e instanceof TypeError||e instanceof DOMException?'预览入口暂未接通，请管理员检查平台预览域名；接通后点击“重新连接”。':e instanceof Error?e.message:'预览打开失败，请重新连接');}}
 }
 renewRef.current=()=>void connect();
 useEffect(()=>{if(!runtime.data)return;if(external){setLoading(false);setSource('');setError('');return;}renewRef.current();return()=>{request.current++;};},[projectId,buildId,external,!!runtime.data]);
 useEffect(()=>{setFilePath('');},[codeCommit]);
 useEffect(()=>{if(!loading){setSlow(false);return;}const timer=setTimeout(()=>setSlow(true),15000);return()=>clearTimeout(timer);},[loading]);
 useEffect(()=>{if(!wide)return;const listener=(e:KeyboardEvent)=>{if(e.key==='Escape')setWide(false);};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[wide]);

 function navigate(value:string){
  try{const next=previewPath(value);if(!origin){renewRef.current();return;}setError('');setPath(next);setDraft(next);setLoading(true);setSource(origin+next);setRevision(r=>r+1);setView('preview');}
  catch(e){setError(e instanceof Error?e.message:'页面路径无效');}
 }
 const choose=(sha:string)=>{onSelectCommit(sha);setFilePath('');};
 return <div className={wide?'fixed inset-0 z-50 bg-background flex flex-col':'rounded-xl border bg-background overflow-hidden'}>
  <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 p-3">
   <div className="flex items-center gap-1" role="tablist" aria-label="项目工作区视图">
    <Button size="sm" role="tab" aria-selected={view==='preview'} variant={view==='preview'?'default':'ghost'} onClick={()=>setView('preview')}><Eye className="h-4 w-4 mr-1"/>预览</Button>
    <Button size="sm" role="tab" aria-selected={view==='code'} variant={view==='code'?'default':'ghost'} onClick={()=>setView('code')}><Code2 className="h-4 w-4 mr-1"/>代码</Button>
    <Button size="sm" role="tab" aria-selected={view==='history'} variant={view==='history'?'default':'ghost'} onClick={()=>setView('history')}><History className="h-4 w-4 mr-1"/>版本</Button>
   </div>
   <div className="flex items-center gap-2 flex-wrap">
    {codeCommit&&<Button size="sm" variant="ghost" asChild><a href={`/api/project-code/download?projectId=${encodeURIComponent(projectId)}&commit=${codeCommit}`}><Download className="h-4 w-4 mr-1"/>下载代码</a></Button>}
    <Button size="sm" variant="outline" title={wide?'返回项目':'展开工作区'} aria-label={wide?'返回项目':'展开工作区'} onClick={()=>setWide(!wide)}>{wide?<Minimize2 className="h-4 w-4"/>:<Maximize2 className="h-4 w-4"/>}</Button>
    <Button size="sm" variant="outline" asChild><Link href={{pathname:'/dashboard/releases',query:{projectId,intent:'publish'}}}>申请上线</Link></Button>
   </div>
  </div>
  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
   <span><strong className="inline-block mr-3 rounded bg-amber-100 text-amber-900 px-2 py-1">测试预览 · 仅供验证</strong>正在运行：<strong className="text-foreground" translate="no">{name(activeCommit)}</strong></span>
   {selectedCommit&&selectedCommit!==activeCommit&&<span>正在查看：<strong translate="no">{name(selectedCommit)}</strong>，预览仍显示当前运行版本</span>}
   <Link className="underline" href={{pathname:'/dashboard/code',query:{projectId}}}>上传新版本</Link>
  </div>
  <div className={view==='preview'?'flex flex-col flex-1 min-h-0':'hidden'}>
   {external?<div className="p-8 min-h-[280px] flex flex-col items-center justify-center gap-4 text-center"><ExternalLink className="h-8 w-8"/><h3 className="font-semibold">在新窗口打开测试应用</h3><p className="text-sm text-muted-foreground">测试使用 HTTP，在独立窗口打开。版本、日志和启停仍在这里管理。</p><Button asChild><a href={launchHref} target="_blank" rel="noopener noreferrer">打开测试应用</a></Button><p className="text-xs text-muted-foreground">每次打开都会校验项目权限，不会重新构建或部署。</p></div>:<>
   <div className="flex flex-wrap items-center gap-2 border-b p-3">
    <Button size="sm" variant="outline" aria-pressed={mobile} aria-label={mobile?'切换电脑预览':'切换手机预览'} onClick={()=>setMobile(!mobile)}>{mobile?<Monitor className="h-4 w-4 mr-1"/>:<Smartphone className="h-4 w-4 mr-1"/>}{mobile?'电脑':'手机'}</Button>
    <form className="flex min-w-40 flex-1 items-center gap-2" onSubmit={e=>{e.preventDefault();navigate(draft);}}>
     <Input aria-label="打开应用路径" title="指定要打开的页面路径；应用内部跳转不会自动改写此输入框" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="/" maxLength={2048}/>
     <Button size="sm" variant="outline" type="submit" disabled={!origin}>前往</Button>
    </form>
    <Button size="sm" variant="outline" disabled={loading} onClick={()=>source?navigate(path):renewRef.current()} title="只刷新页面，不重新部署"><RefreshCw className="h-4 w-4 mr-1"/>刷新预览</Button>
    {origin&&source&&<Button size="sm" variant="outline" asChild><a href={origin+path} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-1"/>单独打开</a></Button>}
   </div>
   {(error||slow)&&<div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-4 border-b bg-muted/40"><p className="text-sm">{error||'页面加载时间较长，可重新连接预览。重新连接不会重新部署应用。'}</p><Button size="sm" variant="outline" onClick={()=>renewRef.current()}>重新连接</Button></div>}
   {loading&&<p role="status" className="px-4 py-2 text-xs text-muted-foreground">正在连接预览…</p>}
   <div className={wide?'flex flex-1 min-h-0 justify-center bg-muted/40 overflow-auto p-3':'flex justify-center bg-muted/40 overflow-auto p-3'}>
    {source?<iframe key={revision} title="项目应用预览" src={source} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" referrerPolicy="no-referrer" onLoad={()=>setLoading(false)} className={`border bg-white ${mobile?'w-[390px] max-w-full rounded-2xl shadow-sm':'w-full rounded-md'} ${wide?'h-full min-h-[360px]':'h-[70vh] min-h-[480px]'}`}/>:<div className="flex min-h-[480px] w-full items-center justify-center rounded-md border bg-background p-8 text-center text-muted-foreground"><div><Eye className="mx-auto mb-4 h-8 w-8"/><p>{error?'应用已运行，预览入口待接通。':'正在打开当前版本的应用预览…'}</p></div></div>}
   </div>
   <p className="px-4 py-2 text-xs text-muted-foreground">刷新只重载上方指定路径，不创建构建任务。预览会话过期时可重新连接。</p>
   </>}
   {runtime.error&&<p role="alert" className="p-4">{runtime.error.message}</p>}
  </div>
  {view==='code'&&<div className="p-4 space-y-3 flex-1 overflow-auto"><div className="flex justify-between items-center gap-3"><p className="text-sm break-all" translate="no">{name(codeCommit)} / {filePath||'项目根目录'}</p>{filePath&&<Button size="sm" variant="outline" onClick={()=>setFilePath(filePath.split('/').slice(0,-1).join('/'))}>返回上级</Button>}</div>{files.isPending?<p>正在读取代码…</p>:files.error?<p role="alert">{files.error.message}</p>:files.data?.kind==='directory'?<div className="divide-y max-h-[70vh] overflow-auto">{files.data.entries.map(f=><button className="block w-full text-left py-3 text-primary break-all" key={f.path} onClick={()=>setFilePath(f.path)} translate="no">{f.type==='directory'?'📁':'📄'} {f.name}</button>)}</div>:files.data?.notice?<p>{files.data.notice}</p>:<pre className="rounded bg-muted p-4 overflow-auto max-h-[70vh] text-xs" translate="no">{files.data?.content}</pre>}</div>}
  {view==='history'&&<div className="p-4 space-y-3 flex-1 overflow-auto"><p className="text-sm text-muted-foreground">选择版本只查看代码。需要切换运行版本时，点击工作区上方的“更新测试版本”。</p>{versions.error&&<p role="alert">{versions.error.message}</p>}{versions.data?.tags.map(t=><div className="flex justify-between gap-3 items-center border rounded-lg p-3" key={t.name}><div><strong translate="no">{t.name}</strong>{t.sha===activeCommit&&<span className="ml-2 text-xs text-muted-foreground">运行中</span>}<p className="text-xs text-muted-foreground" translate="no">{t.sha.slice(0,12)}</p></div><Button size="sm" variant="outline" onClick={()=>{choose(t.sha);setView('code');}}>查看此版本</Button></div>)}{!versions.isPending&&!versions.error&&!versions.data?.tags.length&&<p>暂无已标记版本，请先上传代码。</p>}<Link className="inline-block text-sm text-primary underline" href={{pathname:'/dashboard/code',query:{projectId}}}>管理全部版本与提交记录</Link></div>}
 </div>;
}
