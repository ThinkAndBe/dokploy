export function versionBlockReason(refs:{head:boolean;active:boolean;current:boolean;formal:boolean;request:boolean}){
 if(refs.head)return '这是项目最新代码，请先保存新版本';
 if(refs.active)return '这个版本正在构建或部署';
 if(refs.current)return '这个版本用于当前测试服务（包含已停止、可恢复的测试）';
 if(refs.formal)return '这个版本已被正式上线记录或上线方案引用';
 if(refs.request)return '这个版本已有待处理的上线申请';
 return '';
}
