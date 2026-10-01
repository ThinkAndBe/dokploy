import Link from 'next/link';
import {Button} from '@/components/ui/button';
export function ProjectVersions({projectId}:{projectId:string}){return <Button variant="outline" size="sm" asChild><Link href={`/dashboard/code?projectId=${encodeURIComponent(projectId)}`}>代码与版本</Link></Button>;}
