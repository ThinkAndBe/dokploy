export type Tier='test'|'formal'|'unknown';
export function resourceTier(environmentId:string,targets:{environmentId:string;tier:'test'|'formal'}[]):Tier {
 return targets.find(t=>t.environmentId===environmentId)?.tier??'unknown';
}
export function serviceChange(spec:any,action:'start'|'stop'|'restart',shared:boolean,resumeReplicas=1){
 if(shared)throw new Error('共享数据库服务关联多个应用，不能从单个项目停止或重启');
 if(!spec.Mode?.Replicated||!Number.isInteger(spec.Mode.Replicated.Replicas))throw new Error('仅支持已登记的副本式服务');
 const result=structuredClone(spec),n=spec.Mode.Replicated.Replicas;
 if(action==='restart'&&n===0)throw new Error('服务已停止，请先启动');
 if(action==='start'&&n===0){if(!Number.isInteger(resumeReplicas)||resumeReplicas<1)throw new Error('恢复副本数无效');result.Mode.Replicated.Replicas=resumeReplicas;}
 if(action==='stop')result.Mode.Replicated.Replicas=0;
 if(action==='restart')result.TaskTemplate.ForceUpdate=(result.TaskTemplate.ForceUpdate||0)+1;
 return result;
}
export function backupArguments(engine:'postgres'|'mysql',host:string,name:string,user:string,passwordFile:string){
 if(!/^[a-zA-Z0-9_.-]+$/.test(host)||! /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(name)||! /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(user)||! /^\/run\/secrets\/[a-zA-Z0-9_.-]+$/.test(passwordFile))throw new Error('数据库备份连接配置不受支持，请运维核对');
 return [engine,host,name,user,passwordFile];
}
export function backupMarker(value:string){
 const match=value.match(/^APPHUB_BACKUP_OK ([a-f0-9]{64}) ([1-9][0-9]*)$/m);
 if(!match)throw new Error('备份任务没有返回有效校验信息');
 return {sha256:match[1]!,bytes:Number(match[2])};
}
