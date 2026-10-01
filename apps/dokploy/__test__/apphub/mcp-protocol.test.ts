import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({authenticate:vi.fn(),tools:vi.fn(),call:vi.fn()}));
vi.mock('@dokploy/server/services/apphub-rbac',()=>({authenticateMcp:mocks.authenticate}));
vi.mock('@dokploy/server/services/project-mcp',()=>({mcpTools:mocks.tools,callProjectTool:mocks.call}));
import handler from '../../pages/api/mcp';
function response(){return {code:200,body:null as any,headers:{} as any,setHeader(k:string,v:string){this.headers[k]=v;},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;},end(){return this;}};}
beforeEach(()=>{vi.resetAllMocks();mocks.authenticate.mockResolvedValue({role:'developer',key:{scopes:['read']}});mocks.tools.mockReturnValue([{name:'list_projects'}]);vi.stubEnv('APPHUB_PUBLIC_URL','https://apphub.erke.com');});
const req=(method:string,params?:any)=>({method:'POST',headers:{authorization:'Bearer example'},body:{jsonrpc:'2.0',id:1,method,params}});
it('negotiates a supported protocol and exposes no formal deployment capability',async()=>{const r=response();await handler(req('initialize',{protocolVersion:'2025-06-18'}) as any,r as any);expect(r.body.result.protocolVersion).toBe('2025-06-18');expect(r.body.result.capabilities).toEqual({tools:{listChanged:false}});expect(r.body.result.instructions).toContain('get_submission_guide');expect(r.body.result.instructions).toContain('check_test_compatibility');});
it('rejects revoked authentication before any tool executes',async()=>{mocks.authenticate.mockRejectedValue(Error('revoked'));const r=response();await handler(req('tools/call',{name:'start_test'}) as any,r as any);expect(r.code).toBe(401);expect(mocks.call).not.toHaveBeenCalled();});
it('rejects cross-origin callers',async()=>{const q=req('tools/list');(q.headers as any).origin='https://evil.invalid';const r=response();await handler(q as any,r as any);expect(r.code).toBe(403);expect(mocks.tools).not.toHaveBeenCalled();});
it('returns method-not-found instead of exposing admin operations',async()=>{const r=response();await handler(req('admin/deploy') as any,r as any);expect(r.body.error.code).toBe(-32601);expect(mocks.call).not.toHaveBeenCalled();});
it('does not leak backend database errors through MCP',async()=>{mocks.call.mockRejectedValue(Error('postgres password=private'));const r=response();await handler(req('tools/call',{name:'list_projects'}) as any,r as any);expect(r.body.result.isError).toBe(true);expect(JSON.stringify(r.body)).not.toContain('private');});
it('accepts initialized notification without a response body',async()=>{const q=req('notifications/initialized');delete (q.body as any).id;const r=response();await handler(q as any,r as any);expect(r.code).toBe(202);expect(r.body).toBeNull();});
it('rejects unsupported protocol headers',async()=>{const q=req('tools/list');(q.headers as any)['mcp-protocol-version']='2030-01-01';const r=response();await handler(q as any,r as any);expect(r.code).toBe(400);});

it('explains expired-key renewal without exposing credential values',async()=>{mocks.authenticate.mockRejectedValue(Error('expired'));const r=response();await handler(req('tools/list') as any,r as any);expect(r.code).toBe(401);expect(r.body.hint).toContain('原 KEY 不变');expect(r.body.hint).toContain('已撤销');expect(mocks.tools).not.toHaveBeenCalled();});
