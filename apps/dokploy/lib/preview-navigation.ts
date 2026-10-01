export function previewPath(value: string): string {
 if(/[\u0000-\u001f\u007f]/.test(value))throw new Error('页面路径不能包含控制字符');
 const path=value.trim()||'/';
 if(path.length>2048||!path.startsWith('/')||path.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(path))throw new Error('请输入当前应用的页面路径，例如 / 或 /login');
 const url=new URL(path,'http://preview.invalid');
 let decoded:string;try{decoded=decodeURIComponent(url.pathname);}catch{throw new Error('页面路径编码无效');}
 if(url.origin!=='http://preview.invalid'||decoded.startsWith('//')||decoded.includes('\\')||/^\/_apphub(?:\/|$)/i.test(decoded))throw new Error('只能打开当前应用的业务页面');
 return url.pathname+url.search+url.hash;
}
