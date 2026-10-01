export type AppHubRole='admin'|'developer'|'viewer';
export function effectiveRole(native:string,assigned?:string):AppHubRole{return ['owner','admin'].includes(native)?'admin':assigned==='viewer'?'viewer':'developer';}
export function assertRoleAction(role:AppHubRole,path:string,type:string){
 const database=/^(postgres|mysql|mariadb|mongo|redis|libsql|backup|volumeBackups)\./.test(path)||['release.databases','release.databaseStats','release.databaseCredential'].includes(path);
 if(database&&role!=='admin')throw new Error('数据库管理仅限管理员');
 if(role==='viewer'&&type==='mutation'&&!['build.preview','rbac.createKey','rbac.revokeKey','user.update','user.updatePassword','user.updateLanguage'].includes(path))throw new Error('当前为只读成员，不能修改项目、测试或申请上线');
}
export function canCreateProject(role:AppHubRole,enabled:boolean){return role==='admin'||(role==='developer'&&enabled);}
export function assertKeySelection(role:AppHubRole,enabled:boolean,projects:string[],scopes:string[]){
 if(scopes.includes('create-project')&&!canCreateProject(role,enabled))throw new Error('管理员尚未授予创建项目权限');
 if(!projects.length&&!scopes.includes('create-project'))throw new Error('请选择已有项目，或允许 AI 创建新项目');
 if(role==='viewer'&&scopes.some(s=>s!=='read'))throw new Error('只读成员只能创建读取密钥');
}
export function assertMcpScope(role:AppHubRole,projects:string[],scopes:string[],projectId:string,scope:string){
 if(!projects.includes(projectId)||!scopes.includes(scope))throw new Error('MCP 密钥未授权此项目或操作');
 if(role==='viewer'&&scope!=='read')throw new Error('只读成员不能执行写操作');
}
