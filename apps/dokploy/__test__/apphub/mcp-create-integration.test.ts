import {describe,beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';

import {randomUUID} from 'node:crypto';
vi.mock('../../../../packages/server/src/services/release-store',async()=>{const {default:p}=await import('postgres');return {releaseSql:p('postgres://postgres:local-check-only@127.0.0.1:55438/mcp_check',{max:4})};});
vi.mock('../../../../packages/server/src/services/identity-store',()=>({identitySessionAllowed:async()=>true,identitySchema:async()=>{}}));
vi.mock('../../../../packages/server/src/services/project-repository',()=>({ensureProjectRepository:vi.fn(async()=>({ready:true}))}));
import {releaseSql as sql} from '../../../../packages/server/src/services/release-store';
import {createKey,authenticateMcp,rbacSchema,myProjects} from '../../../../packages/server/src/services/apphub-rbac';
import {createMcpProject} from '../../../../packages/server/src/services/mcp-create-project';
import {assertKeySelection} from '../../../../packages/server/src/services/apphub-role-policy';
import {ensureProjectRepository} from '../../../../packages/server/src/services/project-repository';
describe.skipIf(process.env.APPHUB_MCP_INTEGRATION!=='1')('isolated PostgreSQL MCP creation',()=>{
const actor={id:'alice',organizationId:'org'};
beforeAll(async()=>{
 await sql`create table "user"(id text primary key,banned boolean default false)`;
 await sql`create table member(id text primary key,user_id text,organization_id text,role text,"canCreateProjects" boolean,"accesedProjects" text[] default '{}')`;
 await sql`create table project("projectId" text primary key,name text,description text,"createdAt" text,"organizationId" text)`;
 await sql`create table apphub_project_owner(project_id text primary key references project("projectId") on delete cascade,organization_id text,user_id text)`;
 await rbacSchema();
 await sql`insert into "user"(id) values('alice'),('bob')`;
 await sql`insert into member values('a','alice','org','member',true,'{}'),('b','bob','org','member',true,'{}')`;
});
beforeEach(async()=>{await sql`delete from apphub_project_owner`;await sql`delete from project`;await sql`delete from apphub_mcp_key`;await sql`delete from apphub_user_role`;await sql`update member set "accesedProjects"='{}',"canCreateProjects"=true`;vi.mocked(ensureProjectRepository).mockResolvedValue({ready:true} as any);});
afterAll(async()=>{await sql.end();});
async function key(){const k=await createKey(actor,{name:'check',projects:[],scopes:['read','write','test','create-project'],days:1});return {k,auth:await authenticateMcp(k.token)};}
it('allows an empty project selection only with separately authorized creation',()=>{expect(()=>assertKeySelection('developer',true,[],['read','create-project'])).not.toThrow();expect(()=>assertKeySelection('developer',true,[],['read'])).toThrow();expect(()=>assertKeySelection('developer',false,[],['create-project'])).toThrow();expect(()=>assertKeySelection('viewer',true,[],['create-project'])).toThrow();});
it('creates a personal key first and binds the new private project only to its creator and originating key',async()=>{const {k,auth}=await key();const spare=await key();const r=await createMcpProject(auth,{name:'AI项目',requestKey:randomUUID()});expect(r.created).toBe(true);expect((await authenticateMcp(k.token)).key.projects).toEqual([r.projectId]);expect((await authenticateMcp(spare.k.token)).key.projects).toEqual([]);expect(await myProjects({id:'bob',organizationId:'org'})).toEqual([]);expect((await myProjects(actor))[0]?.id).toBe(r.projectId);expect((await sql`select user_id from apphub_project_owner`)[0]?.user_id).toBe('alice');});
it('deduplicates concurrent retries and rejects altered payloads',async()=>{const {auth}=await key();const input={name:'并发重试',requestKey:randomUUID()};const [a,b]=await Promise.all([createMcpProject(auth,input),createMcpProject(auth,input)]);expect(a.projectId).toBe(b.projectId);expect([a.created,b.created].sort()).toEqual([false,true]);expect(await sql`select * from project`).toHaveLength(1);await expect(createMcpProject(auth,{...input,name:'different'})).rejects.toThrow('请求标识');});
it('denies previously issued creation keys after permission removal',async()=>{const {auth}=await key();await sql`update member set "canCreateProjects"=false where user_id='alice'`;await expect(createMcpProject(auth,{name:'blocked',requestKey:randomUUID()})).rejects.toThrow('创建项目权限');expect(await sql`select * from project`).toHaveLength(0);});
it('checks key revocation again inside the transaction',async()=>{const {k,auth}=await key();await sql`update apphub_mcp_key set revoked=true where id=${k.id}`;await expect(createMcpProject(auth,{name:'blocked',requestKey:randomUUID()})).rejects.toThrow('密钥');expect(await sql`select * from project`).toHaveLength(0);});
it('retains one owned project on repository failure and repairs with the same request key',async()=>{const {auth}=await key(),input={name:'仓库恢复',requestKey:randomUUID()};vi.mocked(ensureProjectRepository).mockRejectedValueOnce(Error('offline'));const a=await createMcpProject(auth,input);expect(a.repositoryStatus).toBe('pending');const b=await createMcpProject(auth,input);expect(b.projectId).toBe(a.projectId);expect(b.repositoryStatus).toBe('ready');expect(b.created).toBe(false);});
it('does not regain an existing project when authorization was removed',async()=>{const {auth}=await key(),input={name:'撤权',requestKey:randomUUID()};await createMcpProject(auth,input);await sql`update member set "accesedProjects"='{}' where user_id='alice'`;await expect(createMcpProject(auth,input)).rejects.toThrow('未授权');});
it('rejects missing scope and owner injection',async()=>{const {auth}=await key();auth.key.scopes=['read'];await expect(createMcpProject(auth,{name:'blocked',requestKey:randomUUID()})).rejects.toThrow();auth.key.scopes=['create-project'];await expect(createMcpProject(auth,{name:'blocked',requestKey:randomUUID(),ownerId:'bob'})).rejects.toThrow();});

});
