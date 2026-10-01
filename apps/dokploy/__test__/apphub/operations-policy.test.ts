import {describe,it,expect} from 'vitest';
import {resourceTier,serviceChange,backupArguments,backupMarker} from '../../../../packages/server/src/services/operations-policy';
const spec=()=>({Name:'project_app',Mode:{Replicated:{Replicas:3}},TaskTemplate:{ContainerSpec:{Image:'registry/app@sha256:fixed',Mounts:[{Type:'volume',Source:'business-data',Target:'/data'}],Secrets:[{SecretID:'keep'}]},ForceUpdate:2}});
describe('project operational boundaries',()=>{
 it('uses declared purpose, never an environment name or prefix',()=>{expect(resourceTier('production',[])).toBe('unknown');expect(resourceTier('build-123',[])).toBe('unknown');expect(resourceTier('real',[{environmentId:'real',tier:'formal'}])).toBe('formal');});
 it.each(['start','stop','restart'] as const)('rejects %s of a shared database',action=>expect(()=>serviceChange(spec(),action,true)).toThrow('共享数据库'));
 it('stops replicas while preserving image, mounts and credentials',()=>{const s=spec(),r=serviceChange(s,'stop',false);expect(r.Mode.Replicated.Replicas).toBe(0);expect(r.TaskTemplate).toEqual(s.TaskTemplate);expect(s.Mode.Replicated.Replicas).toBe(3);});
 it('restores the previous replica count',()=>{const s=spec();s.Mode.Replicated.Replicas=0;expect(serviceChange(s,'start',false,3).Mode.Replicated.Replicas).toBe(3);});
 it('restarts without changing configuration or scale',()=>{const s=spec(),r=serviceChange(s,'restart',false);expect(r.TaskTemplate.ForceUpdate).toBe(3);expect(r.TaskTemplate.ContainerSpec).toEqual(s.TaskTemplate.ContainerSpec);expect(r.Mode).toEqual(s.Mode);});
 it('refuses a restart of a stopped application',()=>{const s=spec();s.Mode.Replicated.Replicas=0;expect(()=>serviceChange(s,'restart',false)).toThrow('已停止');});
 it('rejects global services',()=>expect(()=>serviceChange({Mode:{Global:{}}},'stop',false)).toThrow());
 it.each(['a;drop','$(id)','--help',"a'b",'a b'])('rejects unsafe database identifiers %s',name=>expect(()=>backupArguments('postgres','database',name,'platform_root','/run/secrets/root')).toThrow());
 it('rejects a credential path outside Docker Secrets',()=>expect(()=>backupArguments('postgres','database','epos_reports','platform_root','/etc/passwd')).toThrow());
 it('builds fixed positional arguments without accepting shell commands',()=>expect(backupArguments('postgres','apps-db','epos_reports','platform_root','/run/secrets/root')).toEqual(['postgres','apps-db','epos_reports','platform_root','/run/secrets/root']));
 it('requires a checksum and nonempty artifact for success',()=>{expect(()=>backupMarker('exit 0')).toThrow();expect(()=>backupMarker('APPHUB_BACKUP_OK '+ 'a'.repeat(64)+' 0')).toThrow();expect(backupMarker('APPHUB_BACKUP_OK '+ 'a'.repeat(64)+' 123')).toEqual({sha256:'a'.repeat(64),bytes:123});});
});
