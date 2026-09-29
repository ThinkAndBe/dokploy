import {randomBytes} from 'node:crypto';
import {docker} from '../constants';
import {encryptValue,decryptValue} from '../lib/encryption';
import {releaseSql,type Plan} from './release-store';
import {databaseIdentity,poolSecretFiles,type DatabaseConfiguration} from './database-policy';

async function schema(){await releaseSql`create table if not exists apphub_managed_database(plan_id uuid primary key, service_id text not null, organization_id text not null, environment_id text not null, credentials text not null, created_at timestamptz not null default now())`;}
export async function prepareDatabase(p:Plan){
 await schema();const c=p.payload.input.configuration as DatabaseConfiguration;
 const [prior]=await releaseSql`select * from apphub_managed_database where plan_id=${p.id}`;
 let credentials:{password:string;root:string;admin:string};
 if(prior)credentials=JSON.parse(decryptValue(prior.credentials));
 else {credentials={password:randomBytes(32).toString('hex'),root:randomBytes(32).toString('hex'),admin:randomBytes(32).toString('hex')};await releaseSql`insert into apphub_managed_database(plan_id,service_id,organization_id,environment_id,credentials) values(${p.id},${p.service_id},${p.organization_id},${p.environment_id},${encryptValue(JSON.stringify(credentials))})`;}
 const files=poolSecretFiles(c,p.id,credentials.password,credentials.root,credentials.admin),d=databaseIdentity(p.id);
 for(const [key,value] of Object.entries(files)){
  const name=d.secret+'-'+key,existing=(await docker.listSecrets({filters:JSON.stringify({name:[name]})})).find((s:any)=>s.Spec.Name===name);
  if(existing){if(existing.Spec?.Labels?.['apphub.plan']!==p.id)throw new Error('密钥名称冲突');continue;}
  await docker.createSecret({Name:name,Labels:{'apphub.plan':p.id,'apphub.organization':p.organization_id},Data:Buffer.from(value).toString('base64')});
 }
}
async function execute(service:string,cmd:string[],env:string[]=[]){
 const containers=await docker.listContainers({filters:JSON.stringify({label:['com.docker.swarm.service.name='+service]})});
 if(containers.length!==1)throw new Error('数据库副本不在本管理节点或尚未运行');
 const e=await docker.getContainer(containers[0]!.Id).exec({Cmd:cmd,Env:env,AttachStdout:true,AttachStderr:true});
 const stream=await e.start({hijack:false,stdin:false});const chunks:Buffer[]=[];
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{stream.destroy();reject(new Error('连接池检查超时'))},15000);stream.on('data',c=>chunks.push(Buffer.from(c)));stream.on('end',()=>{clearTimeout(timer);resolve()});stream.on('error',e=>{clearTimeout(timer);reject(e)});});
 if((await e.inspect()).ExitCode!==0)throw new Error('连接池尚未就绪或数据库认证失败');
 const b=Buffer.concat(chunks);let out='';for(let i=0;i+8<=b.length;){const n=b.readUInt32BE(i+4);out+=b.subarray(i+8,i+8+n).toString();i+=8+n;}return out;
}
async function secretsFor(p:Plan){await schema();const [r]=await releaseSql`select credentials from apphub_managed_database where plan_id=${p.id} and organization_id=${p.organization_id}`;if(!r)throw new Error('数据库尚未开通');return JSON.parse(decryptValue(r.credentials)) as {password:string;root:string;admin:string};}
export async function databaseStats(p:Plan){
 const c=p.payload.input.configuration as DatabaseConfiguration,d=databaseIdentity(p.id),s=await secretsFor(p);
 const data=c.engine==='postgres'?await execute(d.stack+'_pool',['psql','-h','127.0.0.1','-p','6432','-U','pooladmin','-d','pgbouncer','--csv','-c','SHOW POOLS'],['PGPASSWORD='+s.admin]):await execute(d.stack+'_database',['mysql','-h','pool','-P','6032','-u','pooladmin','--batch','-e','SELECT hostgroup,srv_host,srv_port,status,ConnUsed,ConnFree,ConnOK,ConnERR,Queries FROM stats_mysql_connection_pool'],['MYSQL_PWD='+s.admin]);
 return {checkedAt:new Date().toISOString(),engine:c.engine,host:d.host,port:c.engine==='postgres'?6432:6033,database:c.databaseName,user:d.user,poolSize:c.poolSize,maxClients:c.maxClients,mode:'会话兼容模式',healthy:true,statistics:data};
}
export async function verifyDatabase(p:Plan){
 const c=p.payload.input.configuration as DatabaseConfiguration,d=databaseIdentity(p.id),s=await secretsFor(p);
 const out=c.engine==='postgres'?await execute(d.stack+'_pool',['psql','-h','127.0.0.1','-p','6432','-U',d.user,'-d',c.databaseName,'-Atc','SELECT 1'],['PGPASSWORD='+s.password]):await execute(d.stack+'_database',['mysql','-h','pool','-P','6033','-u',d.user,'--batch','--skip-column-names',c.databaseName,'-e','SELECT 1'],['MYSQL_PWD='+s.password]);
 if(out.trim()!=='1')throw new Error('连接池 SQL 连通核验未通过');await databaseStats(p);
}
export async function databaseCredential(p:Plan){const c=p.payload.input.configuration as DatabaseConfiguration,d=databaseIdentity(p.id),s=await secretsFor(p);return {host:d.host,port:c.engine==='postgres'?6432:6033,database:c.databaseName,user:d.user,password:s.password,urlSecret:d.secret+'-url',network:d.network};}
