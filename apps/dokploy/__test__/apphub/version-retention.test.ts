import {it,expect} from 'vitest';
import {defaultRetentionPolicy as defaults,versionEligibility,retentionPolicyInput,type VersionReferences,type VersionEntry} from '../../../../packages/server/src/services/version-retention-policy';
const now=Date.parse('2026-10-04T00:00:00Z'),day=86400000;
const date=(age:number)=>new Date(now-age*day).toISOString();
const versions:VersionEntry[]=Array.from({length:15},(_,i)=>({name:`v1.0.${15-i}`,sha:String(i).padStart(40,'0'),date:date(100+i)}));
function refs():VersionReferences{return {head:'',active:new Set(),test:new Set(),pending:new Set(),deployments:[],holds:new Map()};}
function state(i=14,r=refs(),p=defaults,v=versions){return versionEligibility(v,p,r,now)[i]!;}
it('keeps latest ten even when older than thirty days',()=>{expect(state(9).canDelete).toBe(false);expect(state(10).canDelete).toBe(true);});
it('keeps all recent versions beyond the count limit',()=>{const v=versions.map((v,i)=>({...v,date:date(i)}));expect(versionEligibility(v,defaults,refs(),now).every(v=>!v.canDelete)).toBe(true);});
it('retains the exact time boundary inclusively',()=>{const v=[...versions];v[14]={...v[14]!,observedAt:date(30)};expect(state(14,refs(),defaults,v).canDelete).toBe(false);v[14]={...v[14]!,observedAt:date(30.001)};expect(state(14,refs(),defaults,v).canDelete).toBe(true);});
it('does not let first observation of backdated code become immediately deletable',()=>{const v=versions.map(v=>({...v,observedAt:date(0)}));expect(versionEligibility(v,defaults,refs(),now).every(v=>!v.canDelete)).toBe(true);});
it('retains source head',()=>{const r=refs();r.head=versions[14]!.sha;expect(state(14,r).label).toBe('最新代码');});
it.each(['active','pending','test'] as const)('retains %s refs',key=>{const r=refs();r[key].add(versions[14]!.sha);expect(state(14,r).canDelete).toBe(false);});
it('retains current and previous distinct successful releases per service',()=>{const r=refs();r.deployments=[14,13,13,12,11].map((i,n)=>({sha:versions[i]!.sha,service:'web',image:'image',date:date(100+n)}));expect(state(14,r).label).toBe('正式使用中');expect(state(12,r).label).toBe('回退保留');expect(state(11,r).canDelete).toBe(true);});
it('keeps other current services independently',()=>{const r=refs();r.deployments=[14,13,12,11].map((i,n)=>({sha:versions[i]!.sha,service:String(n),image:'image',date:date(100+n)}));expect(state(11,r).label).toBe('正式使用中');});
it('retains releases inside ninety days beyond rollback count',()=>{const r=refs();r.deployments=[14,13,12,11].map((i,n)=>({sha:versions[i]!.sha,service:'web',image:'image',date:date(n)}));expect(state(11,r).label).toBe('上线保留期内');});
it('extra retention expires but cannot override current references',()=>{const r=refs();r.holds.set(versions[14]!.name,{reason:'调查留存',until:date(-1)});expect(state(14,r).label).toBe('管理员延长保留');r.holds.set(versions[14]!.name,{reason:'调查留存',until:date(0)});expect(state(14,r).canDelete).toBe(true);r.test.add(versions[14]!.sha);expect(state(14,r).canDelete).toBe(false);});
it('fails closed when historical date is unknown',()=>{const v=[...versions];v[14]={...v[14]!,date:''};expect(state(14,refs(),defaults,v).label).toBe('时间待核查');});
it('checks references by SHA across different tag names',()=>{const v=[...versions];v[14]={...v[14]!,sha:v[13]!.sha};const r=refs();r.pending.add(v[13]!.sha);expect(state(14,r,defaults,v).canDelete).toBe(false);});
it('enforces bounded policies without a disable-safety option',()=>{expect(retentionPolicyInput.safeParse({...defaults,keepVersions:0}).success).toBe(false);expect(retentionPolicyInput.safeParse({...defaults,rollbackVersions:1}).success).toBe(false);expect(retentionPolicyInput.safeParse({...defaults,autoDelete:true}).success).toBe(false);});
