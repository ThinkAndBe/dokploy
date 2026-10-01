import type {NextApiRequest,NextApiResponse} from 'next';
import {validateRequest} from '@dokploy/server/lib/auth';
import {testStandard,testStarter} from '@dokploy/server/services/test-standard';
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET')return res.status(405).end();
 const {user,session}=await validateRequest(req);if(!user||!session)return res.status(401).json({error:'请登录 AppHub 后下载'});
 const starter=req.query.kind==='starter';res.setHeader('Content-Type',starter?'application/zip':'text/markdown; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${starter?'apphub-web-starter.zip':'APPHUB-TEST-1.md'}"`);return res.send(starter?testStarter():testStandard);
}
