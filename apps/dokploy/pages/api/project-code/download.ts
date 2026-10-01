import type {NextApiRequest,NextApiResponse} from 'next';
import {validateRequest} from '@dokploy/server/lib/auth';
import {codeArchive,codeProject} from '@dokploy/server/services/project-code';
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'方法不支持'});}
 const {user,session}=await validateRequest(req);
 if(!user||!session||req.headers['x-api-key'])return res.status(401).json({error:'请登录 AppHub 后下载版本'});
 const id=req.query.projectId,commit=req.query.commit;
 if(typeof id!=='string'||typeof commit!=='string'||id.length>200||!/^[a-f0-9]{40}$/.test(commit))return res.status(400).json({error:'版本参数不正确'});
 const actor={id:user.id,organizationId:session.activeOrganizationId||'',name:user.name||user.email,email:user.email};
 try{await codeProject(actor,id);}catch{return res.status(404).json({error:'项目不存在或尚未授权'});}
 try{const response=await codeArchive(actor,id,commit);if(!response.body)throw new Error('版本下载不可用');const reader=response.body.getReader();let total=0;const chunks:Buffer[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>100*1024*1024)throw new Error('版本超过网页下载大小限制，请联系管理员');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
 res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition',`attachment; filename="project-${commit.slice(0,12)}.zip"`);return res.send(Buffer.concat(chunks));
 }catch{return res.status(502).json({error:'版本下载暂时不可用或超过大小限制，请稍后重试或联系管理员'});}
}
