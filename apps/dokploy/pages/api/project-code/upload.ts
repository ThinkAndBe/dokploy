import type {NextApiRequest,NextApiResponse} from 'next';
import {validateRequest} from '@dokploy/server/lib/auth';
import {previewCode,codeProject} from '@dokploy/server/services/project-code';
import {ZIP_LIMIT} from '@dokploy/server/services/code-archive';
export const config={api:{bodyParser:false}};
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'请使用上传操作'});}
 const {user,session}=await validateRequest(req);
 if(!user||!session||req.headers['x-api-key'])return res.status(401).json({error:'请登录 AppHub 后上传代码'});
 const expected=process.env.APPHUB_PUBLIC_URL;
 if(!expected||req.headers.origin!==new URL(expected).origin)return res.status(403).json({error:'请从 AppHub 项目页面上传'});
 const id=req.query.projectId;if(typeof id!=='string'||!id||id.length>200)return res.status(400).json({error:'项目参数不正确'});
 const actor={id:user.id,organizationId:session.activeOrganizationId||'',name:user.name||user.email,email:user.email};
 try{await codeProject(actor,id);}catch{return res.status(404).json({error:'项目不存在或尚未授权'});}
 if(req.headers['content-type']!=='application/zip')return res.status(415).json({error:'请上传 ZIP 代码包'});
 const length=Number(req.headers['content-length']);if(!Number.isFinite(length)||length<=0||length>ZIP_LIMIT)return res.status(413).json({error:'ZIP 文件不能超过 20 MB'});
 try{
  let total=0;const chunks:Buffer[]=[];for await(const chunk of req){const b=Buffer.from(chunk);total+=b.length;if(total>ZIP_LIMIT)return res.status(413).json({error:'ZIP 文件不能超过 20 MB'});chunks.push(b);}
  if(total!==length)return res.status(400).json({error:'文件上传不完整，请重新选择'});
  return res.json(await previewCode(actor,id,Buffer.concat(chunks),req.query.stripRoot==='1'));
 }catch(e){return res.status(400).json({error:e instanceof Error?e.message:'代码上传失败，请重试'});}
}
