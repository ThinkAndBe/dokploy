export function testReplicaChange(spec:any,stack:string,action:'stop'|'resume'){
 if(!/^apphubrel-[a-f0-9]+$/.test(stack)||spec?.Name!==stack+'_app'||spec?.Labels?.['com.docker.stack.namespace']!==stack)throw new Error('测试服务归属不一致，请管理员核查');
 const current=spec.Mode?.Replicated?.Replicas;
 if(!Number.isInteger(current)||current<0||current>1)throw new Error('测试服务副本配置异常，请管理员核查');
 const replicas=action==='stop'?0:1;
 return {changed:current!==replicas,spec:{...spec,Mode:{Replicated:{...spec.Mode.Replicated,Replicas:replicas}}}};
}
export function assertTestLifecycleIdle(statuses:string[]){
 if(statuses.some(s=>['queued','building','built','deploying'].includes(s)))throw new Error('项目正在构建或部署，请等待完成；构建中的任务可先取消');
}
