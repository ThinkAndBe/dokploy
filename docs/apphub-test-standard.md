# AppHub 测试运行标准 APPHUB-TEST-1

适用：保存代码版本后，一键构建并在项目内预览单个 Web 服务。测试不需要审批；正式上线仍由管理员处理。静态检查通过不保证业务功能通过，需完成构建、启动、健康检查及业务验收。

## 源码包
ZIP 最大 20 MB，解压后 60 MB，最多 2000 个文件，每个文件最多 5 MB。推荐 ZIP 根目录放 apphub.json、Dockerfile 或项目入口。单个外层源码文件夹可自动去掉。不要上传 .env、实际密码、私钥、node_modules、.git、构建缓存。

## 运行约定
Linux/amd64。一个 HTTP 服务，监听 0.0.0.0（不能仅监听 localhost）。apphub.json 的 port 必须与应用一致；health 为本服务的路径，应无需业务登录返回 200。默认运行资源：1 GB 内存，文件系统只读，/tmp 可写；长期文件仅写声明的 /data、/app/data 或 /app/uploads。默认测试为单副本，可停止并恢复；本地卷不代表跨节点高可用存储。
构建单任务，最多 4 CPU、8 GB 内存、30 分钟。依赖下载需要网络可达；建议依赖锁文件并固定基础镜像。资源和网络配置由管理员控制，不能由上传代码请求宿主机挂载、Docker socket 或特权运行。

## 可运行类型
1. Dockerfile：最通用。根目录放 Dockerfile、apphub.json。未提供配置时仅在 EXPOSE 唯一数值端口时自动适配。多个端口、动态变量端口必须明确 port。支持 BuildKit RUN --mount。
2. .NET：自动构建支持 net10.0 Web；提供 type=dotnet、entry=.csproj 路径、port=8080、health=/health。其他 .NET 版本用 Dockerfile 自行固定运行时。
3. Vite 静态前端：package.json 有 build 脚本及 Vite，根目录有 index.html，默认 npm 构建、dist 输出。非 dist 输出请配置 output。npm 的 package-lock.json 用 npm ci；无锁文件用 npm install 并提示不可严格复现。pnpm/Bun 特有工作区请提供 Dockerfile。
4. 纯静态：已构建目录包含 index.html，可 type=static、output=dist；根目录已是静态文件可 output="."。平台用 Nginx 提供静态和 SPA 路由，/health 返回 200。
5. Node：type=node、entry=package.json、port、health。使用 Node 24，npm 安装，可选 scripts.build，必须 scripts.start；启动代码从 PORT 环境变量取端口并监听 0.0.0.0。其他运行时用 Dockerfile。

## 配置示例
```json
{"type":"dockerfile","dockerfile":"Dockerfile","port":3000,"health":"/health","storage":{"target":"/data"}}
```
```json
{"type":"static","entry":"package.json","output":"dist","port":8080,"health":"/health"}
```
```json
{"type":"node","entry":"package.json","port":3000,"health":"/health"}
```
子目录项目可用 context="frontend"，dockerfile/entry/output 相对于 context。构建只能访问 context 内文件；需要复制其他目录时将 context 保持根目录，并用根目录 Dockerfile 明确路径。

## 多服务与数据库
上传 Compose 不等于自动运行 Compose。单个 Web 服务模式不会自动创建数据库、Redis、后台任务、消息队列等依赖；应用不能假定生产数据库、账号或配置会进入测试。需要这些依赖的项目必须先由管理员配置独立测试依赖和受保护连接信息，再明确 Web 构建入口。不得为了通过检查删除业务功能或用静态页面替代后端。

## 验收
上传预览检查入口；保存版本；进入测试检查所选 SHA 的配置；开始测试后确认构建、健康检查、登录与业务功能。缺配置不排队，失败会保留日志；同一个运行版本可直接打开，停止后恢复不重新构建。测试结果和版本固定后申请上线，管理员审批发布。

## 版本删除
项目有写权限的成员可手动删除旧版本并在回收站恢复。最新代码、正在构建/部署、当前测试（即使已停止）、正式上线引用、待处理上线申请引用的版本不能删除。删除仅移除版本入口，Git 审计历史和已有数据保留，不做 Git 历史重写，不代表回收 Git 物理磁盘。删除和恢复有操作记录。
