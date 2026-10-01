export type NavigationArea='workspace'|'operations';
const personal=new Set(['/dashboard/mcp','/dashboard/code','/dashboard/preview-open','/dashboard/settings/profile','/dashboard/settings/sessions','/dashboard/version-api']);
export function navigationArea(role:string|undefined,path:string,query:{view?:unknown;mode?:unknown}={}):NavigationArea{
 if(role!=='owner'&&role!=='admin')return 'workspace';
 // Personal tools always stay in the workspace, including direct links and stale query parameters.
 if(personal.has(path))return 'workspace';
 if(path==='/dashboard/home')return query.view==='operations'?'operations':'workspace';
 if(path==='/dashboard/releases')return query.mode==='operations'?'operations':'workspace';
 return 'operations';
}
