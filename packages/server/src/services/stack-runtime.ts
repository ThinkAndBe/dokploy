import {randomBytes} from 'node:crypto';
import {docker} from '../constants';
import {sql} from './build-store';
import {encryptValue,decryptValue} from '../lib/encryption';
import {stackSecretName,type StackSpec} from './stack-policy';
export {validateStackArtifacts} from './stack-policy';
export async function prepareStackSecrets(j:any,p:any){
 if(j.manifest.type!=='stack')return;
 let values:Record<string,string>=p.stack_secrets?JSON.parse(decryptValue(p.stack_secrets)):{};
 for(const key of j.manifest.secretKeys)values[key]??=randomBytes(32).toString('hex');
 await sql`update apphub_build_project set stack_secrets=${encryptValue(JSON.stringify(values))} where project_id=${j.project_id}`;
 for(const key of j.manifest.secretKeys){
  const name=stackSecretName(p.environment_id,key),existing=(await docker.listSecrets({filters:JSON.stringify({name:[name]})})).find(s=>s.Spec?.Name===name);
  if(existing){if(existing.Spec?.Labels?.['apphub.project']!==j.project_id)throw new Error('测试密钥归属冲突');}
  else await docker.createSecret({Name:name,Labels:{'apphub.project':j.project_id,'apphub.environment':p.environment_id},Data:Buffer.from(values[key]!).toString('base64')});
 }
 if(j.manifest.login){const password=values[j.manifest.login.passwordSecret];if(!password)throw new Error('测试初始账号引用了未声明的密钥');await sql`update apphub_build_project set credentials=${encryptValue(JSON.stringify({username:j.manifest.login.username,password}))} where project_id=${j.project_id}`;}
}
