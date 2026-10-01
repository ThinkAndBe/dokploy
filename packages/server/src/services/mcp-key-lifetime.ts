import {z} from 'zod';
export const keyLifetimeDays=z.number().int().min(1,'密钥至少有效 1 天').max(365,'密钥最多有效 365 天');
export const keyExpiryInput=z.object({id:z.string().uuid(),days:keyLifetimeDays}).strict();
export function keyExpiration(days:number,now=Date.now()):Date{
 keyLifetimeDays.parse(days);return new Date(now+days*86400000);
}
