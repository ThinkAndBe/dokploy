import {it,expect} from 'vitest';
import {versionInput,changeVersionInput} from '../../../../packages/server/src/services/version-api';
const sha='a'.repeat(40);
it.each(['v0.30.7-apphub.20261001.1','v2026.10.02-apphub-stack.1','release_20260930','v1.0.0'])('allows existing historical tag %s for delete and restore',name=>{for(const action of ['delete','restore'])expect(changeVersionInput.parse({projectId:'p',name,commit:sha,action}).name).toBe(name);});
it.each(['../x','a..b','/v1','v1.lock','v1.','a/b','a\\b','a?x','a#x','a\u0000b','a\n','', 'v'+'a'.repeat(80)])('rejects unsafe tag %s',name=>expect(changeVersionInput.safeParse({projectId:'p',name,commit:sha,action:'delete'}).success).toBe(false));
it('still requires exact commit and a supported recycle operation',()=>{expect(changeVersionInput.safeParse({projectId:'p',name:'legacy',commit:'main',action:'delete'}).success).toBe(false);expect(changeVersionInput.safeParse({projectId:'p',name:'legacy',commit:sha,action:'purge'}).success).toBe(false);});
it('does not weaken new-version rules',()=>{expect(versionInput.safeParse({projectId:'p',name:'v0.30.7-apphub.20261001.1',commit:sha,description:'fixture change'}).success).toBe(false);expect(versionInput.safeParse({projectId:'p',name:'v0.32.1',commit:sha,description:'fixture change'}).success).toBe(true);});
