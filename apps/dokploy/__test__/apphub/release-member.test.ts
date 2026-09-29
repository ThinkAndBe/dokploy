import {describe,it,expect,vi} from 'vitest';
vi.mock('../../../../packages/server/src/services/release-policy',async original=>({...await original<any>(),releaseTargets:async()=>[{organizationId:'o',projectId:'p',environmentId:'formal',testEnvironmentId:'test',tier:'formal'}]}));
vi.mock('../../../../packages/server/src/services/permission',()=>({findMemberByUserId:async()=>({role:'member',accessedProjects:['p'],accessedEnvironments:['test'],accessedServices:[]})}));
vi.mock('../../../../packages/server/src/db',()=>({db:{query:{environments:{findFirst:async()=>({projectId:'p',project:{organizationId:'o'}})}}}}));
import {submitPlan} from '../../../../packages/server/src/services/release-service';
describe('Members cannot submit deployable production plans',()=>{
 it.each([undefined,'planning-token'])('rejects direct formal submission with API key %s',async apiKey=>{
  await expect(submitPlan({id:'u',organizationId:'o',apiKey},{environmentId:'formal',title:'bypass',idempotencyKey:'ef1ac42d-f729-4530-8ff6-4fdbd3a8cae9',configuration:{kind:'update',serviceId:'prod',component:'app',image:'registry/app@sha256:'+'a'.repeat(64)}})).rejects.toThrow('管理员');
 });
});
