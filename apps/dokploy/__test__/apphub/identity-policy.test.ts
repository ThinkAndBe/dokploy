import {describe,it,expect} from 'vitest';
import {apiSignature,directoryUser,directoryGroup,assertSnapshot,canUseIdentity,fixedCallback,ssoEndpoints} from '../../../../packages/server/src/services/identity-policy';
describe('directory identity and signature',()=>{
 it('matches vendor HMAC test vector',()=>{expect(apiSignature('/api/v1/admin/login?password=123&username=sf','{"status":1,"type":"test"}','8165305','aebd2e3c5ea2449aa2928c102f9db276','1629527100','f5f0fe63-5b3e-4e44-908c-b95758b6d7e4')['X-Ca-Sign']).toBe('5eec2b22d4ad87daac420d9ef1476346da46ecabbfb2ed18a744d571cdde7756');});
 it('preserves employee leading zeroes and absent email',()=>{const r=directoryUser({id:'id1',name:'00009999',displayName:'测试员工',status:1,groupPath:'/集团/IT'});expect(r.employee_number).toBe('00009999');expect(r.email).toBe('');expect(r.department).toBe('IT');});
 it.each([{status:0},{status:1,isDeleted:1},{status:1,expiredTime:1000}])('rejects disabled deleted or expired users %o',extra=>{expect(directoryUser({id:'1',name:'u',...extra}).enabled).toBe(false);});
 it('requires stable source id',()=>expect(()=>directoryUser({name:'u'})).toThrow());
 it('builds full department path from parent and name',()=>expect(directoryGroup({id:'g',path:'/集团',name:'IT'}).path).toBe('/集团/IT'));
 it('rejects incomplete snapshot',()=>expect(()=>assertSnapshot([{id:'a'}],2)).toThrow());
 it('rejects duplicated pages',()=>expect(()=>assertSnapshot([{id:'a'},{id:'a'}],2)).toThrow());
 it('accepts complete snapshot',()=>expect(()=>assertSnapshot([{id:'a'},{id:'b'}],2)).not.toThrow());
 it.each([{source_enabled:false,access_enabled:true},{source_enabled:true,access_enabled:false},{source_enabled:true,access_enabled:true,missing:true},{source_enabled:true,access_enabled:true,expires_at:'2000-01-01'}])('does not confuse source authentication with platform access %o',r=>expect(canUseIdentity(r)).toBe(false));
 it('allows explicitly authorized active identity',()=>expect(canUseIdentity({source_enabled:true,access_enabled:true,missing:false})).toBe(true));
 it('uses configured public origin for callback',()=>expect(fixedCallback('http://apphub.erke.com')).toBe('http://apphub.erke.com/api/auth/atrust/callback'));
 it('rejects callback to other host',()=>expect(()=>fixedCallback('http://apphub.erke.com','http://other/callback')).toThrow());
});

describe('separate employee login and backend API endpoints',()=>{
 it('keeps employee 443 separate from directory/control 4433',()=>expect(ssoEndpoints('https://atrust.erke.com:4433','https://atrust.erke.com')).toEqual({ssoServer:'https://atrust.erke.com',apiServer:'https://atrust.erke.com:4433'}));
 it('allows an explicit backend override independently',()=>expect(ssoEndpoints('https://saved','https://employee/','https://api/')).toEqual({ssoServer:'https://employee',apiServer:'https://api'}));
 it('preserves existing saved configuration when no override exists',()=>expect(ssoEndpoints('https://saved/')).toEqual({ssoServer:'https://saved',apiServer:'https://saved'}));
});
