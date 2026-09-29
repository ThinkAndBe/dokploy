import {useState} from 'react';
import type {ReactElement} from 'react';
import type {GetServerSidePropsContext} from 'next';
import {validateRequest} from '@dokploy/server/lib/auth';
import {DashboardLayout} from '@/components/layouts/dashboard-layout';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
export default function VersionApi(){
 const [key,setKey]=useState(''),[keyId,setKeyId]=useState('');
 const create=api.project.createVersionKey.useMutation({onSuccess:r=>{setKey(r.key);setKeyId(r.id);}});
 const revoke=api.user.deleteApiKey.useMutation({onSuccess:()=>{setKey('');setKeyId('');create.reset();}});
 const projects=api.project.workspace.useQuery();
 return <main className="max-w-4xl mx-auto w-full p-6 space-y-6"><header><h1 className="text-3xl font-semibold">版本管理接口</h1><p className="mt-2 text-muted-foreground">供开发工具、脚本和 AI 接入。只能操作你获授权的项目；建立版本不会部署应用。</p></header>
 <section className="border rounded-xl p-5 space-y-3"><h2 className="font-semibold text-xl">1. 生成专用密钥</h2><p className="text-sm">有效期 7 天，仅允许读取项目、读取版本和建立版本。不能执行部署、审批或查看密码。密钥仅显示一次。</p><Button disabled={create.isPending||!!keyId} onClick={()=>create.mutate({})}>生成版本管理密钥</Button>{key&&<><textarea aria-label="版本管理密钥" className="w-full rounded border p-2 bg-background" value={key} readOnly/><Button variant="outline" onClick={()=>{setKey('');create.reset();}}>隐藏密钥</Button></>}{keyId&&<Button variant="outline" disabled={revoke.isPending} onClick={()=>revoke.mutate({apiKeyId:keyId})}>撤销刚生成的密钥</Button>}{(create.error||revoke.error)&&<p role="alert">{create.error?.message||revoke.error?.message}</p>}<p className="text-sm"><a className="text-primary underline" href="/dashboard/settings/profile">在个人设置中管理和撤销已有 API 密钥</a></p></section>
 <section className="border rounded-xl p-5 space-y-3"><h2 className="font-semibold text-xl">2. 选择项目</h2>{projects.error?<p role="alert">项目列表读取失败，请刷新。</p>:projects.data?.map(p=><p key={p.projectId}><span translate="no">{p.name}</span>：<code className="select-all" translate="no">{p.projectId}</code></p>)}</section>
 <section className="border rounded-xl p-5 space-y-3"><h2 className="font-semibold text-xl">3. 调用接口</h2><p>请求头：<code>x-api-key: 你的专用密钥</code></p><p>读取版本：<code>GET /api/project.repositoryVersions?projectId=项目ID&amp;page=1</code></p><p>建立版本：<code>POST /api/project.createVersion</code>，使用 JSON 请求体：</p><pre className="overflow-auto rounded bg-muted p-4">{JSON.stringify({projectId:'项目ID',name:'v1.2.0',commit:'仓库中已存在的40位完整提交SHA',description:'本次版本说明'},null,2)}</pre><p className="text-sm text-muted-foreground">同名版本指向同一提交时可安全重试；同名版本指向其他提交时拒绝覆盖。读取每页最多 20 条，返回 hasMore 表示是否还有下一页。</p></section>
 <section className="border rounded-xl p-5 space-y-2"><h2 className="font-semibold">代码与测试</h2><p>代码提交使用 Git 仓库自己的授权。此密钥不代替 Git 凭据，也不提供源码上传接口。保存版本后回到项目，选择版本进行测试；当前独立构建服务尚未接入。</p></section>
 </main>;
}
VersionApi.getLayout=(page:ReactElement)=><DashboardLayout>{page}</DashboardLayout>;
export async function getServerSideProps(ctx:GetServerSidePropsContext){const {user}=await validateRequest(ctx.req);if(!user)return {redirect:{destination:'/',permanent:false}};return {props:{}};}
