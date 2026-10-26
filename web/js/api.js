import { API } from './config.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 调用后台。用 text/plain 发 JSON，浏览器就不会先发“预检请求”（Apps Script 不支持预检）。
 * 返回 {ok:true,data} 或 {ok:false,error:'代码'}；网络问题统一成 error:'network'。
 */
export async function call(a, p = {}, t) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let j;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ a, p, t }) });
      j = await res.json();
    } catch (e) {
      return { ok: false, error: 'network' };
    }
    if (!j || typeof j.ok !== 'boolean') return { ok: false, error: 'server' };
    if (!j.ok && j.error === 'busy' && attempt < 2) { await sleep(700); continue; } // 别人正在写表，稍等再试
    return j;
  }
  return { ok: false, error: 'busy' };
}
