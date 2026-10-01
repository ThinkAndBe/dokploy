# AppHub 集群构建执行器

当前采用现有 Swarm 节点运行受控执行器。普通用户只操作项目和版本，不接触 Docker socket、镜像仓库密码或节点配置。

## 一次性配置

1. 构建并保存 `Dockerfile` 对应执行器镜像到 AppHub 独立仓库。固定镜像摘要。
2. 在 Swarm 创建已有构建令牌和仓库配置两个 Docker Secrets；实际密码不能进入代码包或 Git。`registry_config` 是 Docker config.json 内容，仅提供给执行器。
3. 将镜像仓库 CA 创建为 Docker Config（公钥证书，无需私钥）：`docker config create apphub-build-registry-ca-v1 registry-ca.crt`。设置 `APPHUB_REGISTRY_CA_CONFIG=apphub-build-registry-ca-v1`。
4. 设置 `APPHUB_WORKER_IMAGE`、`APPHUB_BUILD_NODE`、`APPHUB_NODE_IMAGE`、`APPHUB_NGINX_IMAGE`、`APPHUB_BUILDKIT_IMAGE`、两项 .NET 镜像变量。基础镜像由运维维护并固定摘要；示例类型使用 Node 24 Debian bookworm、Nginx stable-bookworm、BuildKit docker-container 驱动。旧 Docker 20.10 节点已实测 Debian 方案；不要默认采用新版 Alpine 镜像。
5. 按 `worker-stack.yml` 更新构建服务，确认平台 `build.status` 中执行器在线。更换执行器前先确认构建和测试部署队列空闲。

## 资源与清理

平台一次领取一个构建。每个构建创建独立 BuildKit 容器，限制 4 CPU、8 GB 内存和 30 分钟构建时长。应用源码只能进入构建 context，不会获得 Docker socket、执行器令牌或宿主机挂载。执行器本身持有 Docker socket，属于管理员受控基础设施，不是面向不可信代码的强隔离虚拟机；后续可迁到专用构建节点而不改变用户流程。

构建结束删除本任务源码工作区、BuildKit 容器及本任务缓存卷、镜像临时 tag。保留构建日志、结果和已推送镜像摘要，不使用全局 prune，也不会清理其他业务应用的卷。工作卷先本地持久化，后续挂载 NFS/对象存储前须另行设计源码缓存和镜像保留策略。

构建成功后仍需测试部署和应用健康检查通过，才标为“已准备好”。升级期间未知状态的正式发布不会自动重放；测试也不应绕过版本和项目权限。

## 故障边界

- 私有仓库拉取失败：检查执行器专用仓库凭据与 CA，不关闭 TLS 校验。
- npm/NuGet 或 Dockerfile 公共基础镜像下载失败：检查构建节点出口，或由运维镜像/代理；静态检查不代表下载可达。
- Dockerfile 多端口或多服务仓库：先按 `docs/apphub-test-standard.md` 明确入口；上传 Compose 不会启动依赖。
- 运行只读写入失败：改到 /tmp 或声明的持久化目录，不能改成特权或挂载宿主机来规避。
- 停止测试只回收运行资源，保留数据；删除版本只移入回收站，保留 Git 历史，二者不是磁盘清理。
