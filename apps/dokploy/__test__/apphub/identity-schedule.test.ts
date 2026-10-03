import {it,expect} from 'vitest';
import {identityScheduleInput} from '../../../../packages/server/src/services/identity-schedule';
it.each([5,15,30,60,1440,10080])('accepts interval %s',intervalMinutes=>expect(identityScheduleInput.parse({enabled:true,intervalMinutes})).toEqual({enabled:true,intervalMinutes}));
it.each([0,4,10081,-1,1.5,NaN,Infinity,'30',null])('rejects invalid interval %s',intervalMinutes=>expect(()=>identityScheduleInput.parse({enabled:true,intervalMinutes})).toThrow());
it('requires an explicit boolean enable flag',()=>expect(()=>identityScheduleInput.parse({enabled:'false',intervalMinutes:30})).toThrow());
it('keeps interval when disabled',()=>expect(identityScheduleInput.parse({enabled:false,intervalMinutes:60})).toEqual({enabled:false,intervalMinutes:60}));
