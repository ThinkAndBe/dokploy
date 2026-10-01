import {describe,it,expect} from 'vitest';
import {parseReleaseCompose,stringifyReleaseCompose} from '../../../../packages/server/src/services/release-compose-policy';
describe('platform-generated Compose update compatibility',()=>{
 it('reads bounded benign aliases in historical generated stacks',()=>{const r=parseReleaseCompose('services:\n  app:\n    cap_drop: &caps [ALL]\n  preview_access:\n    cap_drop: *caps\n');expect(r.services.app.cap_drop).toEqual(['ALL']);expect(r.services.app.cap_drop).not.toBe(r.services.preview_access.cap_drop);});
 it('serializes shared objects without producing YAML aliases',()=>{const caps=['ALL'];const text=stringifyReleaseCompose({services:{app:{cap_drop:caps},preview_access:{cap_drop:caps}}});expect(text).not.toContain('&a1');expect(text).not.toContain('*a1');expect(parseReleaseCompose(text).services.app.cap_drop).toEqual(['ALL']);});
 it('rejects oversized, cyclic and malformed stacks',()=>{expect(()=>parseReleaseCompose('x'.repeat(256*1024+1))).toThrow();expect(()=>parseReleaseCompose('services: &a {app: *a}')).toThrow('循环');expect(()=>parseReleaseCompose('services: []')).toThrow();});
 it('retains protection against exponentially expanding aliases',()=>{const lines=['a: &a [x,x,x,x,x,x,x,x,x,x]'];let prior='a';for(let i=0;i<5;i++){const current='a'+i;lines.push(current+': &'+current+' ['+Array(10).fill('*'+prior).join(',')+']');prior=current;}lines.push('services: {app: *'+prior+'}');expect(()=>parseReleaseCompose(lines.join('\n'))).toThrow();});
});
