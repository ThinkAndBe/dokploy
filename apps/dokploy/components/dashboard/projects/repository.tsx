import { ProjectVersions } from "./versions";
import { GitBranch, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";

export function ProjectRepository({ projectId, url, status }: { projectId: string; url: string | null; status: string }) {
    const utils = api.useUtils();
    const retry = api.project.retryRepository.useMutation({
        onSuccess: () => { void utils.project.all.invalidate(); toast.success("代码仓库已关联"); },
        onError: error => toast.error(error.message),
    });
    return <div className="flex items-center gap-2 px-2 py-3 text-sm">
        <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
        {url && /^https?:\/\//.test(url) ? <ProjectVersions projectId={projectId}/> :
        status === "failed" ? <><span className="text-amber-700 dark:text-amber-400">代码仓库创建未成功</span><Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate({projectId})}><RefreshCw className="h-4 w-4 mr-1" />{retry.isPending ? "重试中…" : "重试"}</Button></> :
        <span className="text-muted-foreground">尚未关联代码仓库，请联系运维</span>}
    </div>;
}
