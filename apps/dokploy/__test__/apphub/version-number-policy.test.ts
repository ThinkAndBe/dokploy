import {it,expect} from 'vitest';
import {versionAdvice,assertNextVersion,commitChannel} from '../../../../packages/server/src/services/version-number-policy';
it('increments by purpose and carries without string sorting',()=>{expect(versionAdvice(['v1.9.9','v1.10.0'])).toEqual({current:'v1.10.0',patch:'v1.10.1',minor:'v1.11.0',major:'v2.0.0'});});
it('starts a new project and preserves the old AppHub baseline',()=>{expect(versionAdvice(['v20261001.1']).patch).toBe('v1.0.0');expect(versionAdvice(['v0.30.7-apphub.20261002.11']).minor).toBe('v0.31.0');});
it('rejects dates, suffixes, leading zeros and incomplete numbers',()=>{for(const n of ['v20261002.1','v1.0.0-20261002','v01.2.3','v1.0','1.2.3','v1.2.03'])expect(()=>assertNextVersion(n,['v1.0.0'])).toThrow();});
it('rejects duplicates, rollback and skipping versions',()=>{for(const n of ['v1.2.3','v1.2.2','v1.2.5','v1.4.0'])expect(()=>assertNextVersion(n,['v1.2.3'])).toThrow();for(const n of ['v1.2.4','v1.3.0','v2.0.0'])expect(()=>assertNextVersion(n,['v1.2.3'])).not.toThrow();});
it('uses only server appended source metadata and labels legacy honestly',()=>{expect(commitChannel('description\nAppHub-Source: mcp\nAppHub-User: u1\n')).toBe('AI / MCP');expect(commitChannel('AppHub-Source: mcp\nmalicious description\nAppHub-Source: web\nAppHub-User: u2\n')).toBe('网页提交');expect(commitChannel('old commit')).toContain('未记录');});
