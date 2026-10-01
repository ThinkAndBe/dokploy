import {codeArchive,codeProject} from './project-code';
import {readCodeArchive} from './code-archive';
import {inspectTestSource} from './test-compatibility';
export async function inspectProjectTest(a:{id:string;organizationId:string},projectId:string,commit:string){
 const actor={...a,name:'AppHub',email:'build@apphub.invalid'};await codeProject(actor,projectId);
 const response=await codeArchive(actor,projectId,commit);if(!response.body)throw new Error('代码版本不可读取');
 const reader=response.body.getReader();let total=0;const chunks:Buffer[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>20*1024*1024)throw new Error('版本 ZIP 超过 20 MB 标准，请移除生成文件');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
 return inspectTestSource(readCodeArchive(Buffer.concat(chunks),true).files);
}
