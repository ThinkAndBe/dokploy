import {readFileSync} from 'node:fs';
import {encryptValue,decryptValue} from '../lib/encryption';
export {encryptValue};
export const ssoFile=()=>process.env.APPHUB_SSO_CONFIG_FILE||'/etc/dokploy/apphub/atrust-sso.json';
export function readIdentitySSO(){try{const v=JSON.parse(readFileSync(ssoFile(),'utf8'));return {enabled:v.enabled===true,appId:String(v.appId||''),appSecret:v.encryptedSecret?decryptValue(v.encryptedSecret):'',server:String(v.server||''),updatedAt:v.updatedAt};}catch(e:any){if(e.code==='ENOENT')return null;throw new Error('零信任 SSO 配置无法解密或读取');}}
