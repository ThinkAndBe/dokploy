import {describe,it,expect,afterEach,vi} from 'vitest';
import {previewKey,previewConfig,previewOrigin,previewCookieAttributes,safeProxyPath,requestHeaders,responseCookie,allowsFrame} from '../../../../packages/server/src/services/preview-policy';
afterEach(()=>vi.unstubAllEnvs());
const parent='http://apphub.erke.com',origin='http://1234567890abcdef.sandbox.apphub.erke.com';
describe('project preview boundary',()=>{
 it('requires a distinct operator-configured origin',()=>{vi.stubEnv('APPHUB_PUBLIC_URL',parent);vi.stubEnv('APPHUB_PREVIEW_BASE_DOMAIN','sandbox.apphub.erke.com');expect(previewOrigin('build-1234567890abcdef')).toBe(origin);vi.stubEnv('APPHUB_PREVIEW_BASE_DOMAIN','apphub.erke.com');expect(()=>previewConfig()).toThrow();});
 it.each(['apphub.erke.com','1234567890abcdef.sandbox.apphub.erke.com.evil','user.sandbox.apphub.erke.com','1234567890abcdef.sandbox.apphub.erke.com:3000'])('rejects wrong host %s',host=>expect(()=>previewKey(host,'sandbox.apphub.erke.com')).toThrow());
 it('resolves only one exact registered project key',()=>expect(previewKey('1234567890abcdef.sandbox.apphub.erke.com','sandbox.apphub.erke.com')).toBe('1234567890abcdef'));
 it.each(['//evil/a','http://evil/a','/a\\b','/a\rb'])('rejects proxy path injection %s',path=>expect(()=>safeProxyPath(path)).toThrow());
 it('keeps safe paths and queries as application requests',()=>expect(safeProxyPath('/login?returnUrl=%2F')).toBe('/login?returnUrl=%2F'));
 it('strips proxy credentials, internal session and spoofed forwarding headers',()=>{const h=requestHeaders({'cookie':'__apphub_preview=secret; AppSession=ok','host':'evil','x-forwarded-host':'evil','x-forwarded-proto':'https','proxy-authorization':'secret','connection':'X-Remove','x-remove':'secret'},origin);expect(h.cookie).toBe(' AppSession=ok');expect(h.host).toBe(new URL(origin).host);expect(h['x-forwarded-proto']).toBe('http');expect(h).not.toHaveProperty('proxy-authorization');expect(h).not.toHaveProperty('x-remove');expect(JSON.stringify(h)).not.toContain('secret');});
 it('prevents applications from setting parent-domain and gateway-session cookies',()=>{expect(responseCookie('login=x; Domain=.erke.com; HttpOnly; Path=/')).toBe('login=x; HttpOnly; Path=/');expect(responseCookie('__apphub_preview=forged; Path=/')).toBeNull();});
 it('preserves and respects application embedding restrictions',()=>{expect(allowsFrame("default-src 'none'; frame-ancestors 'none'",'',parent,origin)).toBe(false);expect(allowsFrame("frame-ancestors 'self'",'',parent,origin)).toBe(false);expect(allowsFrame('frame-ancestors '+parent,'SAMEORIGIN',parent,origin)).toBe(true);expect(allowsFrame('', 'DENY',parent,origin)).toBe(false);expect(allowsFrame('', '',parent,origin)).toBe(true);});
});

describe('HTTPS platform with HTTP test applications',()=>{
 it('keeps test origin on HTTP when explicitly configured',()=>{vi.stubEnv('APPHUB_PUBLIC_URL','https://apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_BASE_DOMAIN','sandbox.apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_SCHEME','http');expect(previewOrigin('build-1234567890abcdef')).toBe(origin);expect(previewConfig().external).toBe(true);expect(previewCookieAttributes()).toBe('SameSite=Lax');});
 it('retains HTTPS embedded previews by default',()=>{vi.stubEnv('APPHUB_PUBLIC_URL','https://apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_BASE_DOMAIN','sandbox.apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_SCHEME','');expect(previewOrigin('build-1234567890abcdef')).toBe(origin.replace('http:','https:'));expect(previewConfig().external).toBe(false);expect(previewCookieAttributes()).toBe('SameSite=Strict; Secure');});
 it('preserves existing HTTP embedded deployment',()=>{vi.stubEnv('APPHUB_PUBLIC_URL',parent);vi.stubEnv('APPHUB_PREVIEW_BASE_DOMAIN','sandbox.apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_SCHEME','http:');expect(previewConfig().external).toBe(false);});
 it('rejects unsupported preview schemes',()=>{vi.stubEnv('APPHUB_PUBLIC_URL','https://apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_BASE_DOMAIN','sandbox.apphub.erke.com');vi.stubEnv('APPHUB_PREVIEW_SCHEME','javascript');expect(()=>previewConfig()).toThrow();});
});
