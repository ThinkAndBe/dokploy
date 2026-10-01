import {describe,it,expect} from 'vitest';
import {personName,actorName,commitPresentation} from '../../../../packages/server/src/services/user-name-policy';
describe('Human user names without changing identity keys',()=>{
 it('prefers the directory name and does not use a technical email or ID',()=>{expect(personName({display_name:' 张三 ',firstName:'old',lastName:'name'})).toBe('张三');expect(personName({firstName:' 李 ',lastName:' 四 '})).toBe('李 四');expect(personName({})).toBe('未提供姓名');});
 it('labels system actions and unknown people without displaying raw IDs',()=>{expect(actorName('system',new Map())).toBe('系统任务');expect(actorName('internal-user-id',new Map())).toBe('未提供姓名');expect(actorName('user-1',new Map([['user-1','张三']]))).toBe('张三');});
 it('shows the historical MCP actor name without rewriting the original commit',()=>{const message='版本 v1\n\n说明\n\nAppHub-User: user-1\n';const result=commitPresentation(message,'AppHub MCP',new Map([['user-1','张三']]));expect(result).toEqual({author:'张三',message:'版本 v1\n\n说明'});expect(message).toContain('AppHub-User: user-1');});
 it('does not borrow a name when an actor is outside the resolved organization',()=>{const result=commitPresentation('版本 v1\n\nAppHub-User: other-org-user\n','AppHub MCP',new Map([['user-1','张三']]));expect(result.author).toBe('未提供姓名');expect(result.message).not.toContain('other-org-user');});
 it('uses the server-appended final trailer instead of a copied description',()=>{const result=commitPresentation('版本 v1\n\n旧记录\nAppHub-User: another-user\n\nAppHub-User: user-1\n','AppHub MCP',new Map([['another-user','李四'],['user-1','张三']]));expect(result.author).toBe('张三');});
 it('keeps third-party Git author metadata unchanged',()=>{expect(commitPresentation('Original change','Source author',new Map())).toEqual({message:'Original change',author:'Source author'});});
});
