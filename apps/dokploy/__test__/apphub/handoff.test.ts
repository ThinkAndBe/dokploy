import {describe,it,expect} from 'vitest';
import {publicHandoff,canRevealCredential} from '../../../../packages/server/src/services/apphub-handoff';
describe('Application handoff',()=>{
 it('excludes raw passwords and unknown deployment settings',()=>{const x=publicHandoff({title:'EPOS',password:'never-return',env:{secret:'never-return'},account:'admin'});expect(x?.account).toBe('admin');expect(JSON.stringify(x)).not.toContain('never-return');});
 it('does not allow executable or credential-bearing login links',()=>{expect(publicHandoff({loginUrl:'javascript:alert(1)'})?.loginUrl).toBeNull();expect(publicHandoff({loginUrl:'https://u:p@example.com'})?.loginUrl).toBeNull();});
 it('accepts only bounded allowlisted metadata',()=>{expect(publicHandoff(null)).toBeNull();expect(publicHandoff({notes:['note',3],settings:[{label:'version',value:'2.1.2'},null]})?.settings).toEqual([{label:'version',value:'2.1.2'}]);});
 it('limits credential reveal to interactive organization administrators',()=>{expect(canRevealCredential('member',undefined)).toBe(false);expect(canRevealCredential('admin','api-token')).toBe(false);expect(canRevealCredential('owner',undefined)).toBe(true);});
});
