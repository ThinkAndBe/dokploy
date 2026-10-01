import {describe,it,expect} from 'vitest';
import AdmZip from 'adm-zip';
import {readCodeArchive,safeCodePath,blobHash} from '../../../../packages/server/src/services/code-archive';
function zip(files:Record<string,string>){const z=new AdmZip();for(const [p,v] of Object.entries(files))z.addFile(p,Buffer.from(v));return z.toBuffer();}
describe('Code archive boundary',()=>{
 it('preserves folders unless the user explicitly strips a wrapper',()=>{const b=zip({'project/src/index.ts':'export {}','project/package.json':'{}'});expect(readCodeArchive(b).files[0]?.path).toContain('project/');const p=readCodeArchive(b,true);expect(p.removedWrapper).toBe('project/');expect(p.files.map(f=>f.path)).toContain('src/index.ts');});
 it('ignores dependencies and Git internals without saving them',()=>{const a=readCodeArchive(zip({'node_modules/x/a.js':'x','.git/config':'secret','src/app.ts':'ok'}));expect(a.files.map(f=>f.path)).toEqual(['src/app.ts']);expect(a.ignored).toHaveLength(2);});
 it('rejects actual environment files and private keys but accepts examples',()=>{for(const p of ['.env','.env.production','tls.key','client.pfx'])expect(()=>readCodeArchive(zip({[p]:'secret'}))).toThrow();expect(readCodeArchive(zip({'.env.example':'KEY=placeholder'})).files).toHaveLength(1);});
 it('rejects unsafe paths',()=>{for(const p of ['../x','/etc/x','a/../x','a\\b','a\nb','C:/x','a//b'])expect(()=>safeCodePath(p)).toThrow();});
 it('rejects case-colliding filenames',()=>expect(()=>readCodeArchive(zip({'A.ts':'a','a.ts':'b'}))).toThrow('大小写'));
 it('does not accept an empty source archive',()=>expect(()=>readCodeArchive(zip({'node_modules/a':'x'}))).toThrow('没有'));
 it('uses real Git object hashes',()=>expect(blobHash(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a'));
 it('rejects large expanded files before extraction',()=>expect(()=>readCodeArchive(zip({'large.txt':'x'.repeat(6*1024*1024)}))).toThrow('5 MB'));
 it('bounds decompression even if an attacker forges a zero length',()=>{const b=zip({'large.txt':'x'.repeat(6*1024*1024)});for(let i=0;i<b.length-46;i++)if(b.readUInt32LE(i)===0x02014b50)b.writeUInt32LE(0,i+24);expect(()=>readCodeArchive(b)).toThrow();});
 it('rejects symbolic links',()=>{const z=new AdmZip();const e=z.addFile('link',Buffer.from('/etc/passwd'));e.attr=(0xa1ff<<16)>>>0;expect(()=>readCodeArchive(z.toBuffer())).toThrow('符号链接');});
});
