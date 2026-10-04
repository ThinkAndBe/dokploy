#!/usr/bin/env python3
"""Register a verified maintenance deployment without storing administrator secrets."""
import argparse, getpass, http.cookiejar, json, urllib.request
p=argparse.ArgumentParser(description=__doc__)
for key in ('url','project','version','sha','service','image','reason'):p.add_argument('--'+key,required=True)
a=p.parse_args();base=a.url.rstrip('/')
if not base.startswith('https://'):p.error('Use the HTTPS platform address')
http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def post(path,data):
 req=urllib.request.Request(base+path,json.dumps(data).encode(),{'Content-Type':'application/json','Origin':base})
 with http.open(req,timeout=90) as r:return json.load(r)
try:
 post('/api/auth/sign-in/email',{'email':input('管理员邮箱: '),'password':getpass.getpass('管理员密码: ')})
 result=post('/api/trpc/project.recordVersionDeployment',{'json':{'projectId':a.project,'name':a.version,'commit':a.sha,'service':a.service,'image':a.image,'reason':a.reason}})
 if 'error' in result:raise RuntimeError('登记未完成，请管理员查看平台返回状态')
 print('正式部署版本已登记；自动保留规则已覆盖此版本。')
finally:
 try:post('/api/auth/sign-out',{})
 except Exception:pass
