import { projectSubmissionGuide } from '@dokploy/server/services/project-submission-guide';

/** In-memory only: this handoff contains a personal secret and must not be persisted or logged. */
export function mcpOnboardingText(config: string): string {
 if (!config.trim()) return '';
 return [
  '# AppHub AI 接入与完整 MCP 使用指南',
  '这份接入内容包含个人 KEY。仅用于本人信任的 AI 工具私密接入，不得共享或写入源码、README、日志、截图及交付报告。',
  '## 接入配置（含 KEY）',
  '将下方 JSON 保存到 AI 客户端的私密 MCP 设置。若客户端只接受 JSON，只复制代码块内容；后面的指南作为 AI 的任务说明。',
  '```json', config, '```',
  '## 连接后如何工作',
  '先通过 tools/list 确认可用工具，再调用 get_submission_guide 获取当前指南。下面附带完整指南，平台更新后以接口最新返回为准。实际项目范围、权限和密钥有效期以平台校验为准；指南不会额外授予权限。',
  '按用户的业务需求创建或更新项目；先检查已有版本及代码，提交完整快照，选择符合规则的版本号，再检查测试兼容性并跟踪真实构建结果。测试成功不等于完成业务验收。正式上线仅提交申请，由管理员审批。',
  projectSubmissionGuide,
 ].join('\n\n');
}
