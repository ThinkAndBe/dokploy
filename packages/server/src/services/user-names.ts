import {releaseSql as sql} from './release-store';
import {identitySchema} from './identity-store';
import {personName} from './user-name-policy';

// Resolve only users in the authorized organization; do not expose their emails or IDs as names.
export async function userNames(organizationId:string,ids:(string|null|undefined)[]) {
 const keys=[...new Set(ids.filter((id):id is string=>!!id&&id!=='system'))];
 const names=new Map<string,string>();if(!keys.length)return names;
 await identitySchema();
 const rows=await sql`select u.id,u."firstName",u."lastName",i.display_name from member m join "user" u on u.id=m.user_id left join apphub_identity_user i on i.user_id=u.id and i.organization_id=m.organization_id where m.organization_id=${organizationId} and u.id in ${sql(keys)}`;
 for(const row of rows)names.set(String(row.id),personName(row));
 return names;
}
