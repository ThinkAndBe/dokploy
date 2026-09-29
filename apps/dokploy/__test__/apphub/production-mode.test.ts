import {describe,it,expect} from 'vitest';
import {productionWebConfig} from '../../../../packages/server/src/lib/production-mode';
describe('Production transport configuration',()=>{
 it('retains the existing internal test transport when not enabled',()=>expect(productionWebConfig({}).secure).toBe(false));
 it('refuses production startup without a canonical HTTPS origin',()=>{expect(()=>productionWebConfig({APPHUB_REQUIRE_HTTPS:'true'})).toThrow();expect(()=>productionWebConfig({APPHUB_REQUIRE_HTTPS:'true',APPHUB_PUBLIC_URL:'http://apphub.example'})).toThrow();});
 it('uses secure session names compatible with password and zero trust login',()=>{const c=productionWebConfig({APPHUB_REQUIRE_HTTPS:'true',APPHUB_PUBLIC_URL:'https://apphub.example/'});expect(c.sessionCookie).toBe('__Secure-better-auth.session_token');expect(c.cookieSuffix).toBe('; Secure');expect(c.origin).toBe('https://apphub.example');});
 it('rejects credential and path injection in the public origin',()=>{for(const u of ['https://name:secret@apphub.example','https://apphub.example/admin','https://apphub.example/?x=1'])expect(()=>productionWebConfig({APPHUB_PUBLIC_URL:u})).toThrow();});
});
