import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/router';
import Link from 'next/link';
import type {GetServerSidePropsContext} from 'next';
import {validateRequest} from '@dokploy/server/lib/auth';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
export default function PreviewOpen(){
 const router=useRouter();const started=useRef(false);const [error,setError]=useState('');
 const grant=api.build.preview.useMutation();
 const projectId=typeof router.query.projectId==='string'?router.query.projectId:'';
 async function open(){setError('');try{const g=await grant.mutateAsync({projectId});const u=new URL(g.url);if(!['http:','https:'].includes(u.protocol)||u.origin!==g.origin)throw new Error('测试入口无效');window.location.replace(g.url);}catch(e){setError(e instanceof Error?e.message:'测试打开失败，请重试');}}
 useEffect(()=>{if(!router.isReady||started.current)return;started.current=true;if(!projectId){setError('请从项目页面打开测试');return;}void open();},[router.isReady,projectId]);
 return <main className="max-w-xl mx-auto p-8 space-y-4"><h1 className="text-2xl font-semibold">打开测试应用</h1>{error?<><p role="alert">{error}</p>{projectId&&<Button disabled={grant.isPending} onClick={()=>void open()}>重新打开</Button>}</>:<p role="status">正在核验项目权限并打开当前运行的测试版本…</p>}<p className="text-sm text-muted-foreground">仅打开现有应用，不会重新构建或部署。</p><Link className="underline" href="/dashboard/home">返回我的项目</Link></main>;
}
export async function getServerSideProps(ctx:GetServerSidePropsContext){ctx.res.setHeader('Cache-Control','no-store');ctx.res.setHeader('Referrer-Policy','no-referrer');const {user}=await validateRequest(ctx.req);return user?{props:{}}:{redirect:{destination:'/',permanent:false}};}
