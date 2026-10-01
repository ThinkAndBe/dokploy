import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {projectSubmissionGuide} from '@dokploy/server/services/project-submission-guide';
export function AiSubmissionGuide(){
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 return <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">给 AI 的项目提交说明</h2><p>把这份说明与业务需求一起交给 AI。内容包含创建项目、完整源码包、项目文档、测试配置、版本保存、排错及上线申请。MCP 连接后也能读取同一份说明。</p><div className="flex flex-wrap gap-4 items-center"><Button variant="outline" onClick={()=>{void navigator.clipboard.writeText(projectSubmissionGuide).then(()=>{setCopied(true);setError('');}).catch(()=>setError('复制失败，请展开说明手动复制或下载文件。'));}}>{copied?'已复制提交说明':'复制完整提交说明'}</Button><a className="text-primary underline" href="/api/project-code/standard?kind=ai">下载 AI 项目提交说明</a></div>{error&&<p role="alert">{error}</p>}<details><summary className="cursor-pointer">查看完整说明</summary><textarea className="w-full rounded border bg-background p-3 mt-3 text-sm" rows={16} readOnly value={projectSubmissionGuide} aria-label="AI 项目完整提交说明"/></details></section>;
}
