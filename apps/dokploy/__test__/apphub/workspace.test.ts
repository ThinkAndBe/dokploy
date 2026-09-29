import { describe,it,expect,vi,afterEach } from "vitest";
import { accessScope,safeAppUrl } from "../../../../packages/server/src/services/apphub-access";
import { repositoryPath, repositoryVersions } from "../../../../packages/server/src/services/apphub-versions";
import { repoSlug } from "../../../../packages/server/src/services/gitea-integration";
import { translateText,skipTranslation } from "../../components/i18n-zh/translate";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
describe("AppHub consultant workspace",()=>{
 it("requires explicit project, environment and service grants for members",()=>{const s=accessScope({role:"member",accessedProjects:["p"],accessedEnvironments:["test"],accessedServices:["app"]});expect(s.project("p")).toBe(true);expect(s.project("other")).toBe(false);expect(s.environment("production")).toBe(false);expect(s.service("database")).toBe(false)});
 it("does not grant an empty access list to all resources",()=>{const s=accessScope({role:"member",accessedProjects:[],accessedEnvironments:[],accessedServices:[]});expect(s.service("app")).toBe(false);expect(s.environment("test")).toBe(false)});
 it("recognizes organization administrators",()=>expect(accessScope({role:"admin",accessedProjects:[],accessedEnvironments:[],accessedServices:[]}).environment("test")).toBe(true));
 it("rejects executable and credential-bearing app links",()=>{expect(safeAppUrl("javascript:alert(1)")).toBeNull();expect(safeAppUrl("https://user:pass@example.com")).toBeNull();expect(safeAppUrl("//example.com")).toBeNull();expect(safeAppUrl("https://example.com/app")).toBe("https://example.com/app")});
 it("does not fetch a project repository on another origin or path",()=>{vi.stubEnv("GITEA_API_URL","http://gitea:3000");vi.stubEnv("GITEA_DEFAULT_ORG","apphub-apps");const path=`http://gitea:3000/apphub-apps/${repoSlug('', 'p')}`;expect(repositoryPath('p',path)).toContain('/api/v1/repos/');expect(()=>repositoryPath('p',path.replace('gitea:3000','evil.example'))).toThrow();expect(()=>repositoryPath('other',path)).toThrow();expect(()=>repositoryPath('p',path+'?token=secret')).toThrow()});
 it("returns only safe version metadata and refuses redirects",async()=>{vi.stubEnv("GITEA_API_URL","http://gitea:3000");vi.stubEnv("GITEA_DEFAULT_ORG","apphub-apps");vi.stubEnv("GITEA_TOKEN","test-token");vi.stubEnv("GITEA_TOKEN_FILE","");const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{name:'v1',commit:{sha:'abc'},token:'must-not-return'}]))).mockResolvedValueOnce(new Response(JSON.stringify([{sha:'abc',commit:{message:'hello',author:{name:'dev',email:'private@example.com',date:'2026-09-28'}},internal:'must-not-return'}])));vi.stubGlobal('fetch',fetcher);const result=await repositoryVersions('p',`http://gitea:3000/apphub-apps/${repoSlug('', 'p')}`,1);expect(JSON.stringify(result)).not.toContain('must-not-return');expect(JSON.stringify(result)).not.toContain('private@example.com');expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error')});
 it("translates whitespace and dynamic counts",()=>{expect(translateText('  Memory   Usage  ')).toBe('  内存使用率  ');expect(translateText('42 services')).toBe('42 个服务');expect(translateText('Deploy Compose')).toBe('部署编排')});
 it("leaves source identifiers and unknown business text unchanged",()=>{for(const s of ['docker compose up -d','2026-Q3-test','https://example.com','Customer custom title'])expect(translateText(s)).toBe(s)});
 it("excludes protected descendants, not just the enclosing element",()=>{const closest=vi.fn().mockReturnValue({});expect(skipTranslation({closest} as unknown as Element)).toBe(true);expect(closest.mock.calls[0]?.[0]).toContain('[translate=');expect(closest.mock.calls[0]?.[0]).toContain('pre');expect(skipTranslation(null)).toBe(false)});
});

describe("dynamic Chinese monitoring labels",()=>{
 it("retains exact values and units",()=>{expect(translateText("Used: 12.50 GB / Limit: 24 GB")).toBe("已使用：12.50 GB / 总量：24 GB");expect(translateText("In: 0.25 MB / Out: 9.75 MB")).toBe("接收：0.25 MB / 发送：9.75 MB");expect(translateText("Read: 1 MB / Write: 2 MB")).toBe("读取：1 MB / 写入：2 MB")});
 it("preserves names inside deployment feedback",()=>{expect(translateText('Role "Finance-Read" updated')).toBe('角色“Finance-Read”已更新');expect(translateText("4 services queued for deployment")).toBe("4 个服务已加入部署队列")});
});

it("translates raw Docker states and preserves prototype-like business names",()=>{expect(translateText("exited")).toBe("已退出");expect(translateText("constructor")).toBe("constructor");expect(translateText("toString")).toBe("toString")});
