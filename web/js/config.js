// 部署时只需要改这一行：把 Apps Script 部署后得到的网址（以 /exec 结尾）贴在这里。
export const API_URL = 'https://script.google.com/macros/s/REPLACE_ME/exec';

// 本机预览（localhost）默认连本机的模拟后端 /api；
// 想让本机网页连真正的 Apps Script，打开 http://localhost:8080/?api=<网址>。
// 这个覆盖只在 localhost 生效，线上网页不接受网址参数，避免被人拿链接把你的学生引到别处。
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API = isLocal ? (new URLSearchParams(location.search).get('api') || '/api') : API_URL;
export const CONFIGURED = isLocal || !API_URL.includes('REPLACE_ME');
