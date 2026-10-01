import {describe,it,expect} from 'vitest';
import {buildManifest,redactBuildLog,validBuiltImage} from '../../../../packages/server/src/services/build-policy';
describe('source build boundary',()=>{
 it('reads the existing EPOS manifest',()=>expect(buildManifest.parse({type:'dotnet',entry:'src/Epos.Management/Epos.Management.csproj',port:8080,health:'/health'}).entry).toContain('Epos.Management'));
 it('supports a root Dockerfile without execution options',()=>expect(buildManifest.parse({}).dockerfile).toBe('Dockerfile'));
 it.each(['../Dockerfile','/etc/passwd','dir\\Dockerfile','dir/../Dockerfile'])('rejects escaping paths %s',path=>expect(()=>buildManifest.parse({dockerfile:path})).toThrow());
 it('does not accept host mounts or arbitrary Docker flags',()=>expect(()=>buildManifest.parse({privileged:true,mounts:['/var/run/docker.sock']})).toThrow());
 it('rejects arbitrary health URLs',()=>expect(()=>buildManifest.parse({health:'http://internal/secret'})).toThrow());
 it('requires a csproj for dotnet',()=>expect(()=>buildManifest.parse({type:'dotnet',entry:'run.sh'})).toThrow());
 it('limits storage to application data destinations',()=>expect(()=>buildManifest.parse({storage:{target:'/var/run'}})).toThrow());
 it('accepts only the exact expected repository and immutable digest',()=>{const r='registry:5000/builds/project-a',sha='a'.repeat(64);expect(validBuiltImage(r+'@sha256:'+sha,r)).toBe(true);expect(validBuiltImage(r+'-evil@sha256:'+sha,r)).toBe(false);expect(validBuiltImage(r+':latest',r)).toBe(false);});
 it('redacts common secrets and caps log payloads',()=>{const log=redactBuildLog('Authorization: Bearer demo\npassword=sample\nhttps://u:p@registry/path');expect(log).not.toContain('demo');expect(log).not.toContain('sample');expect(log).not.toContain('u:p');expect(redactBuildLog('x'.repeat(200000)).length).toBe(180000);});
});
