import Link from 'next/link';
import {api} from '@/utils/api';
import {Button} from '@/components/ui/button';
export function StartProjectTest({projectId,commit}:{projectId:string;commit?:string}){
 const runtime=api.build.environment.useQuery({projectId},{retry:false});
 if(runtime.data?.externalPreview&&runtime.data.state==='running'&&!commit)return <><Button size="sm" asChild><a href={'/dashboard/preview-open?projectId='+encodeURIComponent(projectId)} target="_blank" rel="noopener noreferrer">打开测试（新窗口）</a></Button><Button size="sm" variant="outline" asChild><Link href={{pathname:'/dashboard/releases',query:{projectId}}}>测试管理</Link></Button></>;
 return <Button size="sm" asChild><Link href={{pathname:'/dashboard/releases',query:{projectId,...(commit?{commit}:{})}}}>{commit?'查看此版本':'进入测试'}</Link></Button>;
}
