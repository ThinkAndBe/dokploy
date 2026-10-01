import {describe,it,expect} from 'vitest';
import {previewPath} from '../../lib/preview-navigation';
describe('preview navigation stays within the current application',()=>{
 it.each(['https://evil.invalid/a','//evil.invalid','/\\evil','/a\n','/_apphub/open?ticket=x','/%5fapphub/open','/%2f%2fevil','/a%ZZ'])('rejects unsafe path %s',path=>expect(()=>previewPath(path)).toThrow());
 it.each([['','/'],['/','/'],['/login?ReturnUrl=%2Fsources','/login?ReturnUrl=%2Fsources'],['/sources#items','/sources#items']])('preserves application paths %s',(input,output)=>expect(previewPath(input)).toBe(output));
});
