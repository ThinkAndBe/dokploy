import type {NextApiRequest,NextApiResponse} from 'next';
import {validateRequest} from '@dokploy/server/lib/auth';
import {testStandard,testStarter} from '@dokploy/server/services/test-standard';
import {projectSubmissionGuide} from '@dokploy/server/services/project-submission-guide';
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET')return res.status(405).end();
 const {user,session}=await validateRequest(req);if(!user||!session)return res.status(401).json({error:'请登录 AppHub 后下载'});
 const ai=req.query.kind==='ai',starter=req.query.kind==='starter';res.setHeader('Content-Type',starter?'application/zip':'text/markdown; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${starter?'apphub-web-starter.zip':ai?'APPHUB-SUBMIT-1.md':'APPHUB-TEST-1.md'}"`);return res.send(starter?testStarter():ai?projectSubmissionGuide:testStandard);
}
