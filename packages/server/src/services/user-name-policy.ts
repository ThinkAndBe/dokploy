// Names are presentation metadata. Never substitute them for permission keys.
export function personName(user: {display_name?: unknown; firstName?: unknown; lastName?: unknown}) {
 const clean=(value:unknown)=>typeof value==='string'?value.trim():'';
 return clean(user.display_name)||[clean(user.firstName),clean(user.lastName)].filter(Boolean).join(' ')||'未提供姓名';
}
export function actorName(id:string|null|undefined,names:ReadonlyMap<string,string>) {
 return id==='system'?'系统任务':(id&&names.get(id))||'未提供姓名';
}
// Only platform-generated Git trailers identify an AppHub actor. Git history stays immutable.
export function commitActor(message:string) {
 return /(?:^|\n)AppHub-User: ([A-Za-z0-9_-]{1,200})[ \t]*(?:\r?\n)*$/.exec(message)?.[1];
}
export function commitPresentation(message:string,author:string,names:ReadonlyMap<string,string>) {
 const id=commitActor(message);
 return {author:id?actorName(id,names):author,
 message:id?message.replace(/\nAppHub-Source: (?:web|mcp)(?=\nAppHub-User: [A-Za-z0-9_-]{1,200}\s*$)/,'').replace(/(?:^|\n)AppHub-User: [A-Za-z0-9_-]{1,200}[ \t]*(?=\r?\n|$)/g,'').trimEnd():message};
}
