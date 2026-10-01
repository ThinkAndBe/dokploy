# AppHub 项目版本管理

平台项目：[AppHub](https://apphub.erke.com/dashboard/code?projectId=a3956964-3b4e-4546-87d7-718ae57b156a)
项目 ID：a3956964-3b4e-4546-87d7-718ae57b156a
MCP 地址：https://apphub.erke.com/api/mcp

本地工作仓库保持原有 Git 历史。平台从 v0.30.7-apphub.20261001.1 建立新的代码快照版本线。

## 日常更新

1. 在本地修改并验证代码，使用 git diff 检查变更，然后提交本地 Git。
2. 使用自己的 MCP 密钥调用 list_projects，确认有 AppHub 项目权限。
3. 上传完整源码 ZIP，调用 preview_code_upload。排除 .git、依赖目录、构建产物、真实环境配置、密钥和证书。
4. 核对返回的新增、修改、移除列表，再调用 save_code_version，填写唯一版本名称，在描述中记录本地 Git 提交号。
5. 使用 list_versions 和 read_code 确认版本。需要测试时才调用 start_test；正式上线提交管理员审批。

MCP 密钥仅保存在 AI 客户端私密配置或当前进程环境变量中，不写入仓库、Git remote、脚本、日志或报告。

构建所需的非敏感默认值位于根目录 .env.production.example，Dockerfile 从此文件复制默认配置。实际运行配置由部署环境提供。
