import AdmZip from 'adm-zip';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
export const ZIP_LIMIT=20*1024*1024,EXPANDED_LIMIT=60*1024*1024,FILE_LIMIT=5*1024*1024,COUNT_LIMIT=2000;
export function safeCodePath(path:string){
 if(!path||path.length>500||path.startsWith('/')||/[\\\x00-\x1f\x7f:]/.test(path)||path.split('/').some(s=>s===''||s==='.'||s==='..'))throw new Error('代码包中包含不安全的文件路径');
 return path;
}
export const blobHash=(data:Buffer)=>createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
export type CodeFile={path:string;data:Buffer;hash:string;mode:'100644'|'100755'};
const crcTable=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data:Buffer){let n=0xffffffff;for(const b of data)n=(n>>>8)^crcTable[(n^b)&255]!;return (n^0xffffffff)>>>0;}
export function readCodeArchive(buffer:Buffer,stripRoot=false){
 if(buffer.length>ZIP_LIMIT)throw new Error('ZIP 文件不能超过 20 MB');
 let zip:AdmZip;try{zip=new AdmZip(buffer);}catch{throw new Error('不是有效的 ZIP 文件');}
 const entries=zip.getEntries();if(entries.length>COUNT_LIMIT*3)throw new Error('代码包条目过多，请移除依赖和生成文件');
 const paths=entries.filter(e=>!e.isDirectory).map(e=>safeCodePath(e.entryName)).filter(p=>!p.split('/').includes('__MACOSX')&&!['.DS_Store','Thumbs.db'].includes(p.split('/').at(-1)!));
 const root=stripRoot&&paths.length&&paths.every(p=>p.includes('/')&&p.split('/')[0]===paths[0]!.split('/')[0])?paths[0]!.split('/')[0]+'/':'';
 const files:CodeFile[]=[],ignored:string[]=[];let total=0;const seen=new Set<string>();
 for(const entry of entries){
  if(entry.isDirectory)continue;
  const original=safeCodePath(entry.entryName);if(original.split('/').includes('__MACOSX')||['.DS_Store','Thumbs.db'].includes(original.split('/').at(-1)!)){ignored.push(original);continue;}const path=safeCodePath(root?original.slice(root.length):original);
  const parts=path.split('/'),name=parts.at(-1)!;
  if(original.split('/').some(p=>['.git','node_modules','.next','__pycache__','.venv','venv','__MACOSX'].includes(p))||['.DS_Store','Thumbs.db'].includes(name)){ignored.push(path);continue;}
  if((name==='.env'||name.startsWith('.env.'))&&!/\.(example|sample|template)$/.test(name))throw new Error(`请移除含实际环境配置的文件：${path}；密码请在平台应用配置中管理`);
  if(/\.(pfx|p12|key)$|^id_(rsa|ed25519)$/.test(name))throw new Error(`请移除私钥文件：${path}`);
  const unix=(entry.attr>>>16)&0xffff;
  if((unix&0xf000)===0xa000)throw new Error(`代码包不能包含符号链接：${path}`);
  if(entry.header.flags&1)throw new Error('不支持加密 ZIP，请上传普通 ZIP');
  if(entry.header.size>FILE_LIMIT||entry.header.size<0)throw new Error(`单个源文件不能超过 5 MB：${path}`);
  total+=entry.header.size;if(total>EXPANDED_LIMIT)throw new Error('解压后的代码总量不能超过 60 MB');
  if(seen.has(path.toLowerCase()))throw new Error(`代码包存在重复或仅大小写不同的路径：${path}`);
  seen.add(path.toLowerCase());if(seen.size>COUNT_LIMIT)throw new Error('源文件数量不能超过 2000');
  let data:Buffer;try{const compressed=entry.getCompressedData();if(entry.header.method===0)data=compressed;else if(entry.header.method===8)data=inflateRawSync(compressed,{maxOutputLength:FILE_LIMIT+1});else throw 0;}catch{throw new Error(`无法读取代码文件或解压大小超限：${path}`);}
  if(data.length!==entry.header.size||data.length>FILE_LIMIT||crc32(data)!==(entry.header.crc>>>0))throw new Error('代码包文件大小或完整性校验失败');
  files.push({path,data,hash:blobHash(data),mode:unix&0o111?'100755':'100644'});
 }
 if(!files.length)throw new Error('代码包内没有可保存的源文件');
 return {files,ignored,total,removedWrapper:root};
}
