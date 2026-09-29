import {latestHandoffs} from "./release-store";
import { readFile, appendFile } from "node:fs/promises";
import { safeAppUrl } from "./apphub-access";

type TextRow = { label: string; value: string };
export type Handoff = { title: string; loginUrl: string | null; loginMethod: string; account: string; credentialHint: string; notes: string[]; settings: TextRow[]; updatedAt: string };
const text = (v: unknown, limit = 2000) => typeof v === "string" ? v.slice(0, limit) : "";
export function publicHandoff(raw: unknown): Handoff | null {
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
 const r=raw as Record<string,unknown>;
 return {title:text(r.title,200),loginUrl:safeAppUrl(r.loginUrl),loginMethod:text(r.loginMethod),account:text(r.account,200),credentialHint:text(r.credentialHint),notes:Array.isArray(r.notes)?r.notes.filter((v):v is string=>typeof v==='string').slice(0,20).map(v=>text(v)):[],settings:Array.isArray(r.settings)?r.settings.slice(0,30).filter((v):v is TextRow=>!!v&&typeof v==='object'&&typeof v.label==='string'&&typeof v.value==='string').map(v=>({label:text(v.label,200),value:text(v.value)})):[],updatedAt:text(r.updatedAt,100)};
}
export async function readHandoff(serviceId:string) {
 if(process.env.APPHUB_RELEASE_POLICY_FILE){const latest=await latestHandoffs();if(Object.hasOwn(latest,serviceId))return publicHandoff(latest[serviceId]);}
 const file=process.env.APPHUB_HANDOFF_FILE;
 if(!file)return null;
 const all=JSON.parse(await readFile(file,'utf8'));
 return Object.hasOwn(all,serviceId)?publicHandoff(all[serviceId]):null;
}
export function canRevealCredential(role:string,apiKey:unknown){return (role==='owner'||role==='admin')&&!apiKey;}
export async function revealCredential(serviceId:string,userId:string,organizationId:string){
 const file=process.env.APPHUB_CREDENTIALS_FILE,audit=process.env.APPHUB_CREDENTIAL_AUDIT_FILE;
 if(!file||!audit)throw new Error('凭据尚未登记，请联系运维');
 const all=JSON.parse(await readFile(file,'utf8'));
 const value=Object.hasOwn(all,serviceId)?all[serviceId]:null;
 if(!value||typeof value.password!=='string'||!value.password)throw new Error('凭据尚未登记，请联系运维');
 await appendFile(audit,JSON.stringify({time:new Date().toISOString(),action:'reveal-initial-credential',serviceId,userId,organizationId})+'\n',{mode:0o600});
 return {password:value.password};
}
