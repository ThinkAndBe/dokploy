import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createRepositoryVersion} from '../../../../packages/server/src/services/apphub-versions';
import {versionInput} from '../../../../packages/server/src/services/version-api';
vi.mock('../../../../packages/server/src/services/version-governance',()=>({withVersionLock:async(_id:string,fn:()=>Promise<unknown>)=>fn(),enforceVersion:vi.fn()}));
import {repoSlug} from '../../../../packages/server/src/services/gitea-integration';
const sha='a'.repeat(40),url=`http://gitea:3000/apphub-apps/${repoSlug('','p')}`;
beforeEach(()=>{vi.stubEnv('GITEA_API_URL','http://gitea:3000');vi.stubEnv('GITEA_DEFAULT_ORG','apphub-apps');vi.stubEnv('GITEA_TOKEN','fixture');vi.stubEnv('GITEA_TOKEN_FILE','');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('Immutable version API',()=>{
 it('rejects branch names, path traversal and invalid Git tag names',()=>{for(const name of ['../x','a..b','/v1','v1.lock','v1.'])expect(versionInput.safeParse({projectId:'p',name,commit:sha}).success).toBe(false);expect(versionInput.safeParse({projectId:'p',name:'v1.0',commit:'main'}).success).toBe(false);});
 it('creates a tag only after checking the full source commit',async()=>{const f=vi.fn().mockResolvedValueOnce(Response.json({sha})).mockResolvedValueOnce(new Response('',{status:404})).mockResolvedValueOnce(Response.json({commit:{sha}}));vi.stubGlobal('fetch',f);expect(await createRepositoryVersion('p',url,'v1.0.0',sha,'changes')).toEqual({name:'v1.0.0',sha,created:true});expect(JSON.parse(f.mock.calls[2]![1].body)).toEqual({tag_name:'v1.0.0',target:sha,message:'changes'});expect(f.mock.calls.every(c=>c[1].redirect==='error')).toBe(true);});
 it('retries the same name and commit without a second write',async()=>{const f=vi.fn().mockResolvedValueOnce(Response.json({sha})).mockResolvedValueOnce(Response.json({commit:{sha}}));vi.stubGlobal('fetch',f);expect((await createRepositoryVersion('p',url,'v1.0.0',sha,'')).created).toBe(false);expect(f).toHaveBeenCalledTimes(2);});
 it('refuses to move an existing version to other code',async()=>{const f=vi.fn().mockResolvedValueOnce(Response.json({sha})).mockResolvedValueOnce(Response.json({commit:{sha:'b'.repeat(40)}}));vi.stubGlobal('fetch',f);await expect(createRepositoryVersion('p',url,'v1.0.0',sha,'')).rejects.toThrow('其他代码');expect(f).toHaveBeenCalledTimes(2);});
 it('rejects missing source and does not create a tag',async()=>{const f=vi.fn().mockResolvedValue(new Response('',{status:404}));vi.stubGlobal('fetch',f);await expect(createRepositoryVersion('p',url,'v1.0.0',sha,'')).rejects.toThrow();expect(f).toHaveBeenCalledTimes(1);});
 it('never forwards a server token to another repository',async()=>{const f=vi.fn();vi.stubGlobal('fetch',f);await expect(createRepositoryVersion('other',url,'v1.0.0',sha,'')).rejects.toThrow();expect(f).not.toHaveBeenCalled();});
 it('does not treat transient errors as missing tags',async()=>{const f=vi.fn().mockResolvedValueOnce(Response.json({sha})).mockResolvedValueOnce(new Response('',{status:503}));vi.stubGlobal('fetch',f);await expect(createRepositoryVersion('p',url,'v1.0.0',sha,'')).rejects.toThrow();expect(f).toHaveBeenCalledTimes(2);});
});
