import {buildRuntimeLog} from './build-service';
import {z} from 'zod';
import {authenticateMcp,authorizedProject,myProjects,audit} from './apphub-rbac';
import {assertMcpScope} from './apphub-role-policy';
import {codeProject,browseCode,previewCode,commitCode} from './project-code';
import {repositoryVersions,createRepositoryVersion} from './apphub-versions';
import {versionInput} from './version-api';
import {startBuild,listBuilds,buildDetail} from './build-service';
import {testEnvironment,changeTestEnvironment} from './build-environment';
import {requestPublish} from './publish-request';
import {accessiblePlan} from './release-service';
import {createMcpProject} from './mcp-create-project';
import {userNames} from './user-names';
import {actorName} from './user-name-policy';
import {projectSubmissionGuide} from './project-submission-guide';
import {inspectProjectTest} from './test-source';
import {redactBuildLog} from './build-policy';
const pid=z.string().min(1).max(200),sha=z.string().regex(/^[a-f0-9]{40}$/);
const definitions=[
 ['get_submission_guide','提交前先读取完整项目提交说明：创建项目、源码包、README/依赖、测试标准、版本与上线申请','read',{}],
 ['check_test_compatibility','核验本项目指定提交的测试入口及配置；不会构建或部署','read',{projectId:{type:'string'},commit:{type:'string'}}],
 ['test_runtime_log','读取本项目测试组件脱敏运行日志，用于排查容器启动失败','read',{projectId:{type:'string'},buildId:{type:'string'}}],
 ['test_build_detail','读取本项目指定构建的状态、脱敏错误及构建日志，不读取账号密码','read',{projectId:{type:'string'},buildId:{type:'string'}}],
 ['create_project','创建归当前用户所有的项目及代码仓库，并自动绑定到当前密钥；requestKey 为 UUID，同一请求重试必须复用','create-project',{name:{type:'string'},description:{type:'string'},requestKey:{type:'string'}}],
 ['list_projects','列出密钥授权且当前用户仍可访问的项目','read',{}],
 ['list_versions','查看项目版本及提交记录','read',{projectId:{type:'string'},page:{type:'integer',minimum:1,maximum:100}}],
 ['read_code','读取指定提交的目录或文件','read',{projectId:{type:'string'},commit:{type:'string'},path:{type:'string'}}],
 ['preview_code_upload','上传完整项目 ZIP 的 base64（最多 8 MB），返回变更清单；不会保存版本','write',{projectId:{type:'string'},zipBase64:{type:'string'},stripRoot:{type:'boolean'}}],
 ['save_code_version','将核对过的上传预览保存为新版本；包含移除文件的变更。版本不可覆盖','write',{projectId:{type:'string'},previewId:{type:'string'},name:{type:'string'},description:{type:'string'}}],
 ['create_version','给已有代码提交建立不可覆盖的版本名','write',{projectId:{type:'string'},commit:{type:'string'},name:{type:'string'},description:{type:'string'}}],
 ['test_status','查询测试状态及构建记录，不启动部署','read',{projectId:{type:'string'}}],
 ['start_test','构建并部署指定已保存提交到项目测试环境。requestKey 为 UUID，同一次请求重试必须复用','test',{projectId:{type:'string'},commit:{type:'string'},requestKey:{type:'string'}}],
 ['stop_test','停止测试应用以回收运行资源，保留代码和持久数据','test',{projectId:{type:'string'}}],
 ['resume_test','恢复现有测试应用，不重新构建','test',{projectId:{type:'string'}}],
 ['request_publish','为验证好的测试方案提交正式上线申请；不会审批或正式部署','publish-request',{projectId:{type:'string'},testedPlanId:{type:'string'},description:{type:'string'}}],
] as const;
export function mcpTools(scopes:string[],viewer=false){return definitions.filter(d=>scopes.includes(d[2])&&(!viewer||d[2]==='read')).map(([name,description,,properties])=>({name,description,inputSchema:{type:'object',properties,additionalProperties:false,required:Object.keys(properties).filter(k=>!['page','path','description','stripRoot'].includes(k))},annotations:{readOnlyHint:['get_submission_guide','check_test_compatibility','test_build_detail','test_runtime_log','list_projects','list_versions','read_code','test_status'].includes(name),destructiveHint:name==='save_code_version'||name==='stop_test',openWorldHint:false}}));}
export async function callProjectTool(auth:Awaited<ReturnType<typeof authenticateMcp>>,name:string,raw:unknown){
 const d=definitions.find(d=>d[0]===name);if(!d||!auth.key.scopes.includes(d[2]))throw new Error('MCP 工具未授权');
 const input=z.record(z.string(),z.unknown()).parse(raw??{});const extra=Object.keys(input).filter(k=>!Object.keys(d[3]).includes(k));if(extra.length)throw new Error('工具参数无效');
 if(name==='create_project')return createMcpProject(auth,input);
 if(name==='get_submission_guide')return {standard:'APPHUB-SUBMIT-1',instructions:projectSubmissionGuide};
 if(name==='list_projects')return (await myProjects(auth.actor)).filter(p=>auth.key.projects.includes(p.id));
 const projectId=pid.parse(input.projectId);assertMcpScope(auth.role,auth.key.projects,auth.key.scopes,projectId,d[2]);await authorizedProject(auth.actor,projectId);
 // Only this authenticated, project-scoped adapter delegates to interactive services.
 // The external MCP token is never accepted as a general platform API key.
 const names=await userNames(auth.actor.organizationId,[auth.actor.id]);
 const a={...auth.actor,name:actorName(auth.actor.id,names),email:'mcp@apphub.invalid'};
 await audit(a,'mcp:'+name+':requested',projectId);
 try{let result:unknown;
 switch(name){
 case 'check_test_compatibility':result=await inspectProjectTest(a,projectId,sha.parse(input.commit));break;
 case 'test_runtime_log':{const id=z.string().uuid().parse(input.buildId),j=await buildDetail(a,id);if(j.projectId!==projectId)throw new Error('构建不属于本次授权项目');result=await buildRuntimeLog(a,id);break;}
 case 'test_build_detail':{const j=await buildDetail(a,z.string().uuid().parse(input.buildId));if(j.projectId!==projectId)throw new Error('构建不属于本次授权项目');result={id:j.id,projectId:j.projectId,commit:j.commit,status:j.status,testedPlanId:j.planId,error:j.error?redactBuildLog(j.error):null,log:redactBuildLog(j.log||'')};break;}
 case 'list_versions':{const p=await codeProject(a,projectId);result=await repositoryVersions(projectId,p.giteaRepoUrl!,z.number().int().min(1).max(100).default(1).parse(input.page),a.organizationId);break;}
 case 'read_code':result=await browseCode(a,{projectId,commit:sha.parse(input.commit),path:z.string().max(1000).default('').parse(input.path)});break;
 case 'preview_code_upload':{const base=z.string().max(11200000).parse(input.zipBase64),buffer=Buffer.from(base,'base64');if(buffer.toString('base64')!==base)throw new Error('ZIP Base64 编码无效');if(buffer.length>8*1024*1024)throw new Error('ZIP 超过 8 MB，请使用项目网页上传');result=await previewCode(a,projectId,buffer,z.boolean().default(false).parse(input.stripRoot));break;}
 case 'save_code_version':{const v=versionInput.parse({projectId,name:input.name,description:input.description,commit:'0'.repeat(40)});result=await commitCode(a,{projectId,previewId:z.string().uuid().parse(input.previewId),name:v.name,description:v.description});break;}
 case 'create_version':{const v=versionInput.parse(input),p=await codeProject(a,projectId);result=await createRepositoryVersion(projectId,p.giteaRepoUrl!,v.name,v.commit,v.description);break;}
 case 'test_status':{const env=await testEnvironment(a,projectId),jobs=await listBuilds(a,projectId);result={state:env.state,running:env.running,desired:env.desired,components:env.components,commit:env.commit,openInPlatform:(process.env.APPHUB_PUBLIC_URL||'')+'/dashboard/home',builds:jobs.map(j=>({id:j.id,commit:j.commit_sha,status:j.status,testedPlanId:j.plan_id,createdAt:j.created_at}))};break;}
 case 'start_test':result=await startBuild(a,{projectId,commit:sha.parse(input.commit),requestKey:z.string().uuid().parse(input.requestKey)});break;
 case 'stop_test':case 'resume_test':result=await changeTestEnvironment(a,projectId,name==='stop_test'?'stop':'resume');break;
 case 'request_publish':{const id=z.string().uuid().parse(input.testedPlanId),{plan}=await accessiblePlan(a,id);if(plan.project_id!==projectId||plan.tier!=='test'||plan.payload.input.configuration.kind==='database')throw new Error('请选择本项目的应用测试方案');result=await requestPublish(a,id,z.string().max(2000).default('').parse(input.description));break;}
 }
 await audit(a,'mcp:'+name,projectId);return result;
 }catch(e){await audit(a,'mcp:'+name,projectId,'failed');throw e;}
}
