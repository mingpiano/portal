import { DICT } from './dict.js';
import { esc } from './util.js';

let lang = 'zh';
export const LANGS = ['zh', 'en'];
export const getLang = () => lang;
export function setLang(l) { lang = LANGS.includes(l) ? l : 'zh'; document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }

function raw(key, vars, escVars) {
  let s = DICT[lang][key];
  if (s == null) s = DICT.zh[key];
  if (s == null) return '⟦' + key + '⟧'; // 漏翻译的键会直接显示出来，测试也会抓到
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? (escVars ? esc(vars[k]) : String(vars[k])) : m));
}
/** 用在 HTML 里：变量会被转义，词条本身可以带 <b> 之类标记。 */
export const t = (key, vars) => raw(key, vars, true);
/** 纯文本（提示条、aria-label 等，用 esc() 或 textContent 输出）：变量不转义。 */
export const tx = (key, vars) => raw(key, vars, false);
