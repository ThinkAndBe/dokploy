import { ZH_DICT } from "./dictionary-zh";
import { EXTRA_ZH } from "./dictionary-extra";
import { translateDynamic } from "./dynamic";
const dictionary = { ...ZH_DICT, ...EXTRA_ZH };
export function translateText(text:string):string {
 const normalized=text.replace(/\s+/g," ").trim();
 let result=(Object.hasOwn(dictionary,normalized)?dictionary[normalized]:undefined) || translateDynamic(normalized);
 if(!result){
  const m=normalized.match(/^(\d+) (services?|apps?|containers?|lines?|minutes?|hours?|days?|seconds?)$/i);
  if(m){const nouns:Record<string,string>={service:"个服务",app:"个应用",container:"个容器",line:"行",minute:"分钟",hour:"小时",day:"天",second:"秒"};result=m[1]+" "+nouns[m[2]!.toLowerCase().replace(/s$/,"")];}
 }
 if(!result)return text;
 return (text.match(/^\s*/)?.[0]||"")+result+(text.match(/\s*$/)?.[0]||"");
}
export function skipTranslation(element:Element|null):boolean {
 return !!element?.closest("script,style,code,pre,textarea,[translate='no'],[data-no-translate],[contenteditable],.monaco-editor,.cm-editor,.xterm,[data-log-content]");
}
