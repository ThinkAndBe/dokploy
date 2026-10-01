import {describe,it,expect,vi,afterEach} from 'vitest';
import {effectiveRole,assertRoleAction,assertMcpScope} from '../../../../packages/server/src/services/apphub-role-policy';
import {secureTestCompose,previewEdgeScript} from '../../../../packages/server/src/services/preview-edge-policy';
import vm from 'node:vm';
afterEach(()=>vi.unstubAllEnvs());
describe('AppHub role boundaries',()=>{
 it.each(['owner','admin'])('retains native administrator %s',role=>expect(effectiveRole(role,'viewer')).toBe('admin'));
 it('defaults existing members to developer',()=>expect(effectiveRole('member')).toBe('developer'));
 it.each(['postgres.one','mysql.create','backup.all','release.databases','release.databaseStats','release.databaseCredential'])('blocks non-admin database endpoint %s',path=>{for(const role of ['viewer','developer'] as const)expect(()=>assertRoleAction(role,path,'query')).toThrow();expect(()=>assertRoleAction('admin',path,'mutation')).not.toThrow();});
 it.each(['project.createVersion','project.changeSharing','build.start','build.changeEnvironment','release.requestPublish'])('blocks viewer mutation %s',path=>expect(()=>assertRoleAction('viewer',path,'mutation')).toThrow());
 it('allows a viewer to open an authorized preview',()=>expect(()=>assertRoleAction('viewer','build.preview','mutation')).not.toThrow());
 it('keeps project and operation restrictions independent of admin role',()=>{expect(()=>assertMcpScope('admin',['a'],['test'],'b','test')).toThrow();expect(()=>assertMcpScope('developer',['a'],['read'],'a','test')).toThrow();expect(()=>assertMcpScope('viewer',['a'],['test'],'a','test')).toThrow();expect(()=>assertMcpScope('developer',['a'],['test'],'a','test')).not.toThrow();});
});
describe('test application ingress',()=>{
 it('fails closed when access gateway is unconfigured',()=>expect(()=>secureTestCompose({services:{app:{}}},'build-1234567890abcdef',80,32060)).toThrow());
 it('publishes only authenticated edge and isolates uploaded app from auth network',()=>{vi.stubEnv('APPHUB_PUBLIC_URL','https://apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_BASE_DOMAIN','sandbox.apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_SCHEME','http');vi.stubEnv('APPHUB_PREVIEW_PROXY_IMAGE','registry/node@sha256:'+'a'.repeat(64));vi.stubEnv('APPHUB_PREVIEW_AUTH_NETWORK','auth-network');vi.stubEnv('APPHUB_PREVIEW_AUTH_HOST','apphub');const d=secureTestCompose({networks:{private:{driver:'overlay'}},services:{app:{ports:[{published:32060}],networks:['private'],deploy:{placement:{constraints:['node.hostname == test']}}}}},'build-1234567890abcdef',8088,32060);expect(d.services.app.ports).toBeUndefined();expect(d.services.app.networks).toEqual(['private']);expect(d.services.preview_access.ports[0]).toEqual({target:8080,published:32060,protocol:'tcp',mode:'ingress'});expect(d.services.preview_access.environment.APP_PORT).toBe('8088');expect(()=>new vm.Script(previewEdgeScript)).not.toThrow();});
 it('rejects production environments',()=>expect(()=>secureTestCompose({services:{app:{}}},'production',80,32060)).toThrow());
});
