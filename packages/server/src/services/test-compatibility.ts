import {buildManifest} from './build-policy';
import type {CodeFile} from './code-archive';
export const TEST_STANDARD='APPHUB-TEST-1';
export type CompatibilityIssue={level:'error'|'warning'|'info';path:string;message:string};
export function inspectTestSource(files:Pick<CodeFile,'path'|'data'>[]){
 const source=new Map(files.map(f=>[f.path,f.data.toString('utf8')]));
 const issues:CompatibilityIssue[]=[];let inferred=false;let raw:any;
 const add=(level:CompatibilityIssue['level'],path:string,message:string)=>issues.push({level,path,message});
 const text=(p:string)=>source.get(p)||'';
 function targetFramework(p:string){
  const explicit=text(p).match(/<TargetFramework\s*>\s*([^<]+?)\s*<\/TargetFramework>/);if(explicit)return explicit[1]!.trim();
  const parts=p.split('/');parts.pop();
  while(true){const props=[...parts,'Directory.Build.props'].join('/');if(source.has(props)){const match=text(props).match(/<TargetFramework\s*>\s*([^<]+?)\s*<\/TargetFramework>/);return match?.[1]?.trim()||'';}if(!parts.length)break;parts.pop();}
  return '';
 }
 function parse(p:string){try{return JSON.parse(text(p));}catch{add('error',p,'不是有效 JSON，请修正后保存新版本');return null;}}
 if(source.has('apphub.json'))raw=parse('apphub.json');
 else if(source.has('Dockerfile')){
  const exposes=[...text('Dockerfile').matchAll(/^\s*EXPOSE\s+([^\r\n#]+)/gmi)].flatMap(m=>m[1]!.trim().split(/\s+/));
  const ports=[...new Set(exposes.filter(p=>/^\d+(?:\/tcp)?$/.test(p)).map(p=>Number(p.split('/')[0])))];
  if(ports.length===1&&exposes.every(p=>/^\d+(?:\/tcp)?$/.test(p))){raw={type:'dockerfile',port:ports[0]};inferred=true;add('info','Dockerfile',`自动读取 EXPOSE：使用端口 ${ports[0]}；建议保存 apphub.json 固定健康检查路径`);}
  else{raw={type:'dockerfile'};add('error','Dockerfile','未声明唯一 HTTP 端口。请添加 apphub.json，明确 port 与 health，避免默认端口与应用不一致');}
 }else if(source.has('package.json')){
  const p=parse('package.json');const deps={...p?.dependencies,...p?.devDependencies};
  if(p?.workspaces)add('error','package.json','这是多包项目，请添加 Dockerfile 和 apphub.json，明确构建入口及实际 HTTP 端口');
  else if(deps.vite&&p?.scripts?.build&&source.has('index.html')){raw={type:'static',entry:'package.json',output:'dist',port:8080,health:'/health'};inferred=true;}
  else add('error','package.json','未识别为可自动适配的静态前端。Node 服务请提供 apphub.json（type=node、port、health）和 start 脚本，复杂项目请提供 Dockerfile');
 }else{
  const web=files.filter(f=>f.path.endsWith('.csproj')&&/Microsoft\.NET\.Sdk\.Web/.test(f.data.toString('utf8')));
  if(web.length===1&&targetFramework(web[0]!.path)==='net10.0'){raw={type:'dotnet',entry:web[0]!.path,port:8080};inferred=true;}
  else if(web.length)add('error','apphub.json','.NET 自动适配支持单个 net10.0 Web 入口；其他框架或多个入口请明确 Dockerfile 和端口');
  else if(source.has('index.html')&&!files.some(f=>/\.(csproj|py|go|java|php|rb)$/.test(f.path))){raw={type:'static',output:'.',port:8080,health:'/health'};inferred=true;}
  else add('error','项目根目录','没有找到可运行入口。多组件项目需提供根目录 Dockerfile 和 apphub.json；只有源码不代表可启动的 Web 应用');
 }
 let manifest:ReturnType<typeof buildManifest.parse>|null=null;
 if(raw){const result=buildManifest.safeParse(raw);if(!result.success){for(const i of result.error.issues)add('error','apphub.json',`${i.path.join('.')||'配置'}：${i.message}`);}else manifest=result.data;}
 if(manifest){
  const m=manifest,prefix=m.context?m.context+'/':'';
  const at=(p:string)=>prefix+p;
  if(m.context&&!files.some(f=>f.path.startsWith(prefix)))add('error','apphub.json','context 指定的目录不存在');
  if(m.type==='dockerfile'){
   if(!source.has(at(m.dockerfile)))add('error',at(m.dockerfile),'找不到 Dockerfile；路径相对于 context（默认项目根目录）');
   else if(/RUN\s+--mount=|^#\s*syntax=/mi.test(text(at(m.dockerfile))))add('info',at(m.dockerfile),'使用 BuildKit 构建语法，平台将使用受资源限制的 BuildKit 执行器');
  }else if(m.type==='dotnet'){
   if(!m.entry||!source.has(at(m.entry)))add('error','apphub.json','entry 指定的 .csproj 不存在');
   else if(targetFramework(at(m.entry))!=='net10.0')add('error',at(m.entry),'自动 .NET 构建使用 net10.0；其他目标框架请提供 Dockerfile');
  }else if(m.entry){
   if(m.entry!=='package.json'||!source.has(at(m.entry)))add('error','apphub.json','Node/前端自动构建 entry 应为 context 内的 package.json');
   else{const p=parse(at(m.entry));if(m.type==='static'&&!p?.scripts?.build)add('error',at(m.entry),'缺少 scripts.build');if(m.type==='node'&&!p?.scripts?.start)add('error',at(m.entry),'缺少 scripts.start；启动命令必须监听 0.0.0.0 与 PORT');if(p?.engines?.node&&!/24/.test(p.engines.node))add('warning',at(m.entry),'自动构建使用 Node 24；请检查 engines，其他运行时请使用 Dockerfile');}
  }else if(m.type==='node')add('error','apphub.json','Node 服务需要 entry=package.json');
  else if(!source.has(at(m.output==='.'?'index.html':m.output+'/index.html')))add('error','apphub.json','静态目录内没有 index.html；源码前端需指定 entry=package.json');
  if(m.entry==='package.json'&&!source.has(at('package-lock.json')))add('warning',at('package.json'),'未提供 package-lock.json，将使用 npm install；建议提交锁文件保证版本可复现');
  if(source.has('docker-compose.yml')||source.has('compose.yaml')||source.has('compose.yml'))add('warning','Compose','自动测试只启动一个 Web 服务，不会自动启动 Compose 中的数据库或其他服务；外部依赖须由管理员接入并配置');
 }
 if(!manifest&&!issues.some(i=>i.level==='error'))add('error','apphub.json','未能生成可用的构建配置');
 const runnable=!!manifest&&!issues.some(i=>i.level==='error');
 return {standard:TEST_STANDARD,runnable,status:runnable?(inferred?'auto':'ready'):'needs_configuration',label:runnable?(inferred?'平台可自动适配':'构建配置检查通过'):'需补齐测试配置',manifest,issues,
  guidance:'检查通过表示入口与配置格式可用。实际构建仍取决于依赖下载，启动仍取决于应用、数据库与健康检查。测试为 Linux/amd64 单个 HTTP 服务，容器只读、/tmp 可写，持久化仅限声明的数据目录。'};
}
