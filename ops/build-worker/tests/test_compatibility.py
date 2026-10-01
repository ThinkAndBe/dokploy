import unittest,os,tempfile,importlib.util,pathlib,json,zipfile,io
TEMP=tempfile.TemporaryDirectory();ROOT=pathlib.Path(TEMP.name);(ROOT/'token').write_text('test-only-token')
os.environ.update(APPHUB_URL='http://unconfigured.invalid',APPHUB_BUILD_TOKEN_FILE=str(ROOT/'token'),APPHUB_WORK_ROOT=str(ROOT/'work'))
spec=importlib.util.spec_from_file_location('worker',pathlib.Path(__file__).resolve().parents[1]/'worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
class CompatibilityTests(unittest.TestCase):
 def source(self,files):
  p=ROOT/str(len(list(ROOT.iterdir())));p.mkdir()
  for name,text in files.items():f=p/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(text)
  return p
 def test_static_readonly_nonroot_health(self):
  p=self.source({'index.html':'<html>'});df=w.dockerfile(p,{'type':'static','output':'.','port':8080});s=df.read_text();self.assertIn('\nUSER 10001:10001\n',s);self.assertIn('COPY . /app/www',s);self.assertIn('location = /health',(p/'.apphub-nginx.conf').read_text());self.assertIn('pid /tmp/',(p/'.apphub-nginx.conf').read_text())
 def test_vite_locked_build(self):
  p=self.source({'package.json':json.dumps({'scripts':{'build':'vite build'}}),'package-lock.json':'{}'});s=w.dockerfile(p,{'type':'static','entry':'package.json','output':'dist','port':8080}).read_text();self.assertIn('RUN npm ci\n',s);self.assertIn('COPY --from=build /src/dist',s)
 def test_node_port_and_user(self):
  p=self.source({'package.json':json.dumps({'scripts':{'start':'node app.js'}})});s=w.dockerfile(p,{'type':'node','entry':'package.json','port':3000}).read_text();self.assertIn('PORT=3000',s);self.assertIn('\nUSER node\n',s)
 def test_nested_context(self):
  p=self.source({'web/Dockerfile':'FROM node:24'});self.assertEqual(w.dockerfile(p,{'type':'dockerfile','context':'web','dockerfile':'Dockerfile'}),p/'web/Dockerfile')
 def test_dotnet_keeps_target_filename(self):
  p=self.source({'src/Api.csproj':'<Project/>'});s=w.dockerfile(p,{'type':'dotnet','entry':'src/Api.csproj','port':8080}).read_text();self.assertIn('-getProperty:TargetFileName',s)
 def test_path_escape(self):
  for p in ['../bad','/abs','a\\b','a:b','a/../b']:
   with self.assertRaises(ValueError):w.safe_path(p)
 def test_archive_symlink_and_traversal(self):
  for name,attr in [('../bad',0),('wrapper/link',0o120777<<16)]:
   data=io.BytesIO()
   with zipfile.ZipFile(data,'w') as z:i=zipfile.ZipInfo(name);i.external_attr=attr;z.writestr(i,'content')
   with self.assertRaises(ValueError):w.unpack(data.getvalue(),ROOT/'unsafe')
if __name__=='__main__':unittest.main()
