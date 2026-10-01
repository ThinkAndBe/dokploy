import {describe,it,expect} from 'vitest';
import {testReplicaChange,assertTestLifecycleIdle} from '../../../../packages/server/src/services/build-lifecycle-policy';
const stack='apphubrel-a123';
const spec={Name:stack+'_app',Labels:{'com.docker.stack.namespace':stack},Mode:{Replicated:{Replicas:1}},TaskTemplate:{ContainerSpec:{Image:'registry/builds/a@sha256:'+'a'.repeat(64),Mounts:[{Type:'volume',Source:'retained-data',Target:'/data'}],Secrets:[{SecretName:'kept'}]},Placement:{Constraints:['node.hostname == sandbox']},ForceUpdate:2},EndpointSpec:{Ports:[{PublishedPort:32060,TargetPort:8080}]}};
describe('project test lifecycle',()=>{
 it('stops only replicas while preserving data, secret, image, placement and port',()=>{const r=testReplicaChange(spec,stack,'stop');expect(r.changed).toBe(true);expect(r.spec).toEqual({...spec,Mode:{Replicated:{Replicas:0}}});expect(spec.Mode.Replicated.Replicas).toBe(1);});
 it('resumes the exact existing image without force update',()=>{const stopped=testReplicaChange(spec,stack,'stop').spec;expect(testReplicaChange(stopped,stack,'resume').spec).toEqual(spec);});
 it('is idempotent for repeated stop and resume',()=>{expect(testReplicaChange(spec,stack,'resume').changed).toBe(false);expect(testReplicaChange(testReplicaChange(spec,stack,'stop').spec,stack,'stop').changed).toBe(false);});
 it.each([{Name:'formal_app'},{Labels:{'com.docker.stack.namespace':'other'}},{Mode:{Global:{}}},{Mode:{Replicated:{Replicas:3}}}])('rejects unexpected service scope or mode %j',change=>{expect(()=>testReplicaChange({...spec,...change},stack,'stop')).toThrow();});
 it.each(['queued','building','built','deploying'])('blocks lifecycle while project is %s',s=>expect(()=>assertTestLifecycleIdle([s])).toThrow());
 it('permits stopping or recovering failed and completed jobs',()=>expect(()=>assertTestLifecycleIdle(['ready','failed','cancelled'])).not.toThrow());
});
