import { expect, it } from 'vitest';
import { mcpOnboardingText } from '../../utils/mcp-onboarding';
import { projectSubmissionGuide } from '@dokploy/server/services/project-submission-guide';

const config = JSON.stringify({mcpServers:{apphub:{url:'https://example.test/api/mcp',headers:{Authorization:'Bearer test-only-placeholder'}}}},null,2);
it('copies parseable MCP configuration and the complete current guide together',()=>{
 const text=mcpOnboardingText(config);
 const json=text.split('```json')[1]?.split('```')[0]?.trim();
 expect(JSON.parse(json!)).toEqual(JSON.parse(config));
 expect(text.endsWith(projectSubmissionGuide)).toBe(true);
 expect(text.split('test-only-placeholder')).toHaveLength(2);
});
it('includes version, collaboration, single and multi-service testing, and publishing rules',()=>{
 const text=mcpOnboardingText(config);
 for(const section of ['APPHUB-VERSION-1','真实提交人','APPHUB-TEST-1','APPHUB-STACK-1','preview_code_upload','test_build_detail','request_publish','get_submission_guide']) expect(text).toContain(section);
});
it('does not fabricate an onboarding package when no new key is available',()=>{
 expect(mcpOnboardingText('')).toBe('');
 expect(mcpOnboardingText('  ')).toBe('');
});
