"""AppHub cluster build executor. Only the executor sees the Docker socket.
Uploaded source is sent as a build context; it never receives the socket or worker token.
"""
import os,json,time,pathlib,urllib.request,urllib.parse,urllib.error,zipfile,io,subprocess,threading,shutil,re,signal,shlex
BASE=os.environ['APPHUB_URL'].rstrip('/')
TOKEN=pathlib.Path(os.environ['APPHUB_BUILD_TOKEN_FILE']).read_text().strip()
WORKER=os.environ.get('APPHUB_BUILD_WORKER_ID','cluster-builder')
ROOT=pathlib.Path(os.environ.get('APPHUB_WORK_ROOT','/work')).resolve()
ROOT.mkdir(parents=True,exist_ok=True)
STOP=threading.Event()

def call(action,**data):
 body=json.dumps({'action':action,'workerId':WORKER,**data}).encode()
 req=urllib.request.Request(BASE+'/api/build-worker',data=body,headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)

def safe_path(name):
 if not name or name.startswith('/') or '\\' in name or ':' in name or any(ord(c)<32 for c in name) or any(p in ('','.','..') for p in name.split('/')):raise ValueError('代码包路径无效')
 return name

def unpack(data,dest):
 total=0;seen=set()
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  entries=[e for e in z.infolist() if not e.is_dir()]
  if not entries or len(entries)>4000:raise ValueError('代码包文件数量无效')
  prefixes={e.filename.split('/')[0] for e in entries}
  strip=len(prefixes)==1 and all('/' in e.filename for e in entries)
  for e in entries:
   safe_path(e.orig_filename);safe_path(e.filename);name=e.filename.split('/',1)[1] if strip else e.filename;safe_path(name)
   if name.casefold() in seen:raise ValueError('代码包包含重复路径')
   seen.add(name.casefold())
   if (e.external_attr>>16)&0o170000==0o120000 or e.flag_bits&1:raise ValueError('代码包包含符号链接或加密文件')
   if e.file_size>10*1024*1024:raise ValueError('代码文件过大')
   with z.open(e) as f:content=f.read(10*1024*1024+1)
   total+=len(content)
   if len(content)>10*1024*1024 or total>100*1024*1024:raise ValueError('代码包展开后过大')
   p=dest/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
   if (e.external_attr>>16)&0o111:p.chmod(0o755)

def dockerfile(src,m):
 if m['type']=='dockerfile':
  path=src/safe_path(m['dockerfile'])
  if not path.is_file():raise ValueError('找不到 Dockerfile：'+m['dockerfile'])
  return path
 entry=safe_path(m['entry'])
 if not (src/entry).is_file():raise ValueError('找不到 .NET 项目入口')
 command=['dotnet','publish',entry,'-c','Release','--no-self-contained','-p:PublishSingleFile=false','-p:UseAppHost=false','-o','/out']
 resolve='dotnet msbuild '+shlex.quote(entry)+' -nologo -property:Configuration=Release -getProperty:TargetFileName > /out/.apphub-entry && test -f "/out/$(cat /out/.apphub-entry)"'
 text='FROM '+os.environ.get('APPHUB_DOTNET_SDK_IMAGE','mcr.microsoft.com/dotnet/sdk:10.0')+' AS build\nWORKDIR /src\nCOPY . .\nRUN '+json.dumps(command)+'\nRUN '+json.dumps(['sh','-c',resolve])+'\nFROM '+os.environ.get('APPHUB_DOTNET_RUNTIME_IMAGE','mcr.microsoft.com/dotnet/aspnet:10.0')+'\nWORKDIR /app\nCOPY --from=build /out .\nENV ASPNETCORE_URLS=http://0.0.0.0:'+str(m['port'])+'\nENTRYPOINT '+json.dumps(['sh','-c','exec dotnet "/app/$(cat /app/.apphub-entry)"'])+'\n'
 p=src/'.apphub-generated.Dockerfile';p.write_text(text);return p

class Job:
 def __init__(self,j):self.j=j;self.lines='';self.seq=0;self.cancel=threading.Event();self.done=threading.Event();self.lock=threading.Lock()
 def add(self,s):
  s=s.replace(TOKEN,'[worker credential hidden]')
  with self.lock:self.lines=(self.lines+s)[-170000:]
 def progress(self):
  while not self.done.wait(8):
   try:
    self.seq+=1;r=call('progress',id=self.j['id'],lease=self.j['lease'],seq=self.seq,log=self.lines)
    if r.get('cancel'):self.cancel.set()
   except Exception:self.add('\n执行器与平台连接中断，停止本次任务。\n');self.cancel.set()
 def run(self,args,timeout=1800):
  env={**os.environ,'DOCKER_BUILDKIT':'0'}
  # Child source builds do not receive this process environment; docker sends only the context.
  p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,start_new_session=True)
  def read():
   for chunk in iter(lambda:p.stdout.read1(4096),b''):self.add(chunk.decode(errors='replace'))
  t=threading.Thread(target=read,daemon=True);t.start();deadline=time.monotonic()+timeout
  while p.poll() is None:
   if self.cancel.is_set() or STOP.is_set() or time.monotonic()>deadline:
    os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(8)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
    t.join(3);raise RuntimeError('构建已取消、连接中断或超过30分钟限制')
   time.sleep(.3)
  t.join(3)
  if p.returncode:raise RuntimeError('构建命令失败，请查看构建日志')
 def execute(self):
  j=self.j
  if not re.fullmatch(r'[a-f0-9-]{36}',j['id']):raise ValueError('任务 ID 无效')
  folder=ROOT/'jobs'/j['id'];src=folder/'source';src.mkdir(parents=True,exist_ok=False)
  threading.Thread(target=self.progress,daemon=True).start()
  tag=j['repository']+':build-'+j['id'];success=False
  try:
   if shutil.disk_usage(ROOT).free<5*1024**3:raise RuntimeError('构建存储剩余空间不足5GB，请管理员清理或扩容')
   self.add('读取固定代码版本 '+j['commit']+'\n')
   req=urllib.request.Request(BASE+'/api/build-worker?'+urllib.parse.urlencode({'id':j['id'],'lease':j['lease']}),headers={'Authorization':'Bearer '+TOKEN})
   with urllib.request.urlopen(req,timeout=60) as r:data=r.read(100*1024*1024+1)
   if len(data)>100*1024*1024:raise RuntimeError('代码包过大')
   unpack(data,src);df=dockerfile(src,j['manifest']);self.add('开始构建；最多4核、8GB内存。\n')
   self.run(['docker','build','--force-rm','--memory','8g','--memory-swap','8g','--cpu-period','100000','--cpu-quota','400000','--label','apphub.managed-build=true','--label','apphub.build-job='+j['id'],'-f',str(df),'-t',tag,str(src)])
   if self.cancel.is_set():raise RuntimeError('已取消')
   self.add('\n构建完成，正在保存镜像。\n');self.run(['docker','push',tag],timeout=600)
   raw=subprocess.check_output(['docker','image','inspect',tag],timeout=30);image=json.loads(raw)[0]
   refs=[r for r in image.get('RepoDigests',[]) if r.startswith(j['repository']+'@sha256:')]
   if len(refs)!=1:raise RuntimeError('无法确认构建镜像摘要')
   self.add('\n镜像已保存，平台将自动启动测试服务。\n')
   call('finish',id=j['id'],lease=j['lease'],image=refs[0],log=self.lines);success=True
   (folder/'result.json').write_text(json.dumps({'commit':j['commit'],'image':refs[0]}))
  except Exception as e:
   self.add('\n'+str(e)+'\n')
   try:call('fail',id=j['id'],lease=j['lease'],error=str(e),log=self.lines)
   except Exception:pass
  finally:
   self.done.set();(folder/'build.log').write_text(self.lines)
   if src.resolve().parent==folder.resolve() and folder.resolve().parent==ROOT/'jobs':shutil.rmtree(src,ignore_errors=True)
   # Remove only this job's tag; never prune the shared node's images, volumes or build cache.
   subprocess.run(['docker','image','rm',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)

def main():
 for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:STOP.set())
 config=os.environ.get('APPHUB_DOCKER_CONFIG_FILE')
 if config:
  dest=pathlib.Path('/tmp/apphub-docker-auth');dest.mkdir(mode=0o700,exist_ok=True);shutil.copyfile(config,dest/'config.json');os.chmod(dest/'config.json',0o600);os.environ['DOCKER_CONFIG']=str(dest)
 while not STOP.is_set():
  try:
   j=call('claim',message='集群构建执行器在线 · 单任务 · 工作区持久化')
   if j:Job(j).execute()
  except Exception as e:print('Worker request not completed:',type(e).__name__,flush=True)
  STOP.wait(5)

if __name__=='__main__':main()
