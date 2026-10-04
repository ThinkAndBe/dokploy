import {z} from 'zod';
export const retentionPolicyInput=z.object({keepVersions:z.number().int().min(1).max(1000),keepDays:z.number().int().min(1).max(3650),rollbackVersions:z.number().int().min(2).max(100),releaseDays:z.number().int().min(1).max(3650)}).strict();
export type RetentionPolicy=z.infer<typeof retentionPolicyInput>;
export const defaultRetentionPolicy:RetentionPolicy={keepVersions:10,keepDays:30,rollbackVersions:2,releaseDays:90};
export type VersionEntry={name:string;sha:string;date:string;observedAt?:string};
export type DeploymentEntry={sha:string;service:string;date:string;image:string};
export type VersionReferences={head:string;active:Set<string>;test:Set<string>;pending:Set<string>;deployments:DeploymentEntry[];holds:Map<string,{reason:string;until:string}>};
const days=86400000;
export function versionEligibility(versions:VersionEntry[],p:RetentionPolicy,refs:VersionReferences,now=Date.now()){
 const latest=new Set([...versions].sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)||b.name.localeCompare(a.name)).slice(0,p.keepVersions).map(v=>v.name));
 const current=new Set<string>(),rollback=new Set<string>(),recent=new Set<string>();
 const services=new Map<string,Set<string>>();
 for(const d of [...refs.deployments].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))){
  let seen=services.get(d.service);if(!seen){seen=new Set();services.set(d.service,seen);current.add(d.sha);}
  if(!seen.has(d.sha)){seen.add(d.sha);if(seen.size<=p.rollbackVersions+1)rollback.add(d.sha);}
  if(!Number.isFinite(Date.parse(d.date))||Date.parse(d.date)>=now-p.releaseDays*days)recent.add(d.sha);
 }
 return versions.map(v=>{
  let label='可删除',reason='没有使用引用，且已超出保留范围';
  const hold=refs.holds.get(v.name);
  if(current.has(v.sha)){label='正式使用中';reason='当前正式部署引用此代码，不能删除';}
  else if(refs.active.has(v.sha)||refs.pending.has(v.sha)){label='处理中';reason='正在构建、部署或等待上线处理，不能删除';}
  else if(refs.test.has(v.sha)){label='测试使用中';reason='当前测试使用此代码，包含已停止但仍可恢复的测试';}
  else if(refs.head===v.sha){label='最新代码';reason='项目最新代码需保留，请先保存新版本';}
  else if(rollback.has(v.sha)){label='回退保留';reason=`保留每个正式服务当前版本及之前 ${p.rollbackVersions} 个不同的成功版本`;}
  else if(recent.has(v.sha)){label='上线保留期内';reason=`正式上线后 ${p.releaseDays} 天内保留`;}
  else if(hold&&Date.parse(hold.until)>now){label='管理员延长保留';reason=`保留至 ${hold.until.slice(0,10)}：${hold.reason}`;}
  else if(latest.has(v.name)||Math.max(Date.parse(v.date)||0,Date.parse(v.observedAt||v.date)||0)>=now-p.keepDays*days){label='保留期内';reason=`保留最近 ${p.keepVersions} 个版本，以及 ${p.keepDays} 天内的所有版本`;}
  else if(!Number.isFinite(Date.parse(v.date))){label='时间待核查';reason='版本时间缺失，暂不允许删除';}
  return {...v,label,reason,canDelete:label==='可删除'};
 });
}
