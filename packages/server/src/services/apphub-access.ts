export function accessScope(member: {role: string; accessedProjects: string[]; accessedEnvironments: string[]; accessedServices: string[]}) {
 const admin = member.role === "owner" || member.role === "admin";
 return {admin, project: (id: string) => admin || member.accessedProjects.includes(id), environment: (id: string) => admin || member.accessedEnvironments.includes(id), service: (id: string) => admin || member.accessedServices.includes(id)};
}
export function safeAppUrl(value: unknown): string | null {
 if (typeof value !== "string") return null;
 try { const u=new URL(value); return ["http:","https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
