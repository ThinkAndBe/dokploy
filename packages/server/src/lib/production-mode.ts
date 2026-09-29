export function productionWebConfig(env:Record<string,string|undefined>=process.env){
 const secure=env.APPHUB_REQUIRE_HTTPS==='true';let origin:string|undefined;
 if(env.APPHUB_PUBLIC_URL){const u=new URL(env.APPHUB_PUBLIC_URL);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!['http:','https:'].includes(u.protocol))throw new Error('APPHUB_PUBLIC_URL 必须是网站根地址');origin=u.origin;if(secure&&u.protocol!=='https:')throw new Error('生产入口必须使用 HTTPS');}
 if(secure&&!origin)throw new Error('生产模式必须设置 APPHUB_PUBLIC_URL');
 return {secure,origin,sessionCookie:secure?'__Secure-better-auth.session_token':'better-auth.session_token',cookieSuffix:secure?'; Secure':''};
}
