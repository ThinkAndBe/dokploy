// AppHub runs alongside existing business services. Global prune is opt-in.
export const globalDockerCleanupAllowed = () =>
    process.env.APPHUB_ALLOW_GLOBAL_DOCKER_PRUNE === "true";

export const requireGlobalDockerCleanup = () => {
    if (!globalDockerCleanupAllowed()) {
        throw new Error("AppHub 已禁用全局 Docker 清理，避免影响共用集群中的其他业务。请由运维按项目处理资源。");
    }
};
