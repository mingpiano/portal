/**
 * 季节与节庆的背景装饰。
 * 规则：节庆期间用节庆的颜色和图案；平时按季节。孩子（学生账号、未成年）用更鲜艳的大图案，
 * 老师、家长和成人学生用很淡的小图案，不影响阅读。图案是现场生成的 SVG（data: 地址），不需要任何外部文件。
 */
import { ageOf } from './util.js';

const LNY = { 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3] }; // 春节（公历）
const DAY = 86400000;
const dayDiff = (a, b) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / DAY);
/** 感恩节：十一月第四个星期四。 */
export function thanksgiving(y) { const d = new Date(y, 10, 1); const off = (4 - d.getDay() + 7) % 7; return new Date(y, 10, 1 + off + 21); }

/** 今天处在哪个节庆期；没有返回 null。 */
export function festival(t) {
  const y = t.getFullYear(), m = t.getMonth() + 1, d = t.getDate(), md = m * 100 + d;
  const lny = LNY[y]; if (lny && Math.abs(dayDiff(t, new Date(y, lny[0] - 1, lny[1]))) <= 7) return 'lunar';
  if (md >= 210 && md <= 214) return 'valentine';
  if (md >= 1015 && md <= 1101) return 'halloween';
  const tg = dayDiff(t, thanksgiving(y)); if (tg >= -7 && tg <= 1) return 'thanks';
  if (md >= 1210 && md <= 1226) return 'xmas';
  if (md >= 1227 || md <= 103) return 'newyear';
  return null;
}
export const season = t => { const m = t.getMonth() + 1; return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'fall' : 'winter'; };

export const FEST = {
  halloween: { n: ['万圣节快乐！', 'Happy Halloween!'], ic: '🎃', kid: { g: ['#FFD27A', '#C9A0F5'], e: ['🎃', '👻', '🦇', '🍬', '🌙', '🕸️'] }, ad: { g: ['#F6EEF8', '#FBEFE2'], e: ['🎃', '🍂', '🌙', '🕸️'] } },
  thanks: { n: ['感恩节快乐！', 'Happy Thanksgiving!'], ic: '🦃', kid: { g: ['#FFD9A0', '#F4A261'], e: ['🦃', '🍂', '🍁', '🥧', '🌽', '🍎'] }, ad: { g: ['#FBF1E3', '#F3E3D0'], e: ['🍂', '🍁', '🌾', '🥧'] } },
  xmas: { n: ['圣诞快乐！', 'Merry Christmas!'], ic: '🎄', kid: { g: ['#B7E4C7', '#FFB3B3'], e: ['🎄', '⛄', '🎁', '🔔', '⭐', '❄️'] }, ad: { g: ['#EAF3EE', '#F6ECEC'], e: ['❄️', '⭐', '🎄', '🔔'] } },
  newyear: { n: ['新年快乐！', 'Happy New Year!'], ic: '🎆', kid: { g: ['#A9C7FF', '#FFD6A5'], e: ['🎆', '🎉', '🥳', '✨', '🎈', '🎊'] }, ad: { g: ['#EDF0FA', '#F9F1E6'], e: ['✨', '🎆', '🥂'] } },
  valentine: { n: ['情人节快乐！', "Happy Valentine's Day!"], ic: '💝', kid: { g: ['#FFC2D4', '#FFE3EC'], e: ['💝', '🌹', '💕', '🎹', '🎵', '🍫'] }, ad: { g: ['#FAEDF1', '#F7EAEA'], e: ['🌹', '💕', '🎵'] } },
  lunar: { n: ['新春快乐！', 'Happy Lunar New Year!'], ic: '🧧', kid: { g: ['#FF9A8B', '#FFD86B'], e: ['🧧', '🏮', '🎆', '🐉', '🧨', '🥟'] }, ad: { g: ['#F9EDEA', '#F8F0DC'], e: ['🏮', '🧧', '🎆', '🌸'] } }
};
export const SEAS = {
  spring: { kid: ['#C8F0D2', '#FFE3F0'], ad: ['#EEF5EF', '#F7EFF3'], e: ['🌸', '🦋', '🌷', '🐝'] },
  summer: { kid: ['#BDE8FF', '#FFF1A8'], ad: ['#EAF3F7', '#F9F5E3'], e: ['☀️', '🍦', '🌊', '🍉'] },
  fall: { kid: ['#FFE0B2', '#F6C28B'], ad: ['#F7F0E6', '#F1E7DA'], e: ['🍂', '🍁', '🌰', '🍄'] },
  winter: { kid: ['#CDE8FF', '#EEF3FF'], ad: ['#EDF1F6', '#F4F1F7'], e: ['❄️', '⛄', '🧣', '☃️'] }
};
/** 孩子的“主题角色”：按年龄分——7 岁以下动物，8–10 岁花园，更大的星空。 */
export const STYLES = {
  animals: ['🐶', '🐱', '🐼', '🐰', '🦊', '🐸'], garden: ['🦄', '🌈', '🦋', '🌸', '🐝', '🍓'], space: ['🚀', '⭐', '🪐', '🌙', '🛸', '🌠']
};
export function styleOf(student) {
  const a = student && student.birth ? ageOf(student.birth) : null;
  return a == null || a <= 7 ? 'animals' : a <= 10 ? 'garden' : 'space';
}

/** 背景要用的颜色和图案：{g:[渐变两端], e:[emoji], kid}。 */
export function themeFor(today, student) {
  const kid = !!(student && student.kind === 'child');
  const occ = festival(today), se = season(today);
  if (occ) { const v = FEST[occ][kid ? 'kid' : 'ad']; return { g: v.g, e: v.e, kid, occ }; }
  return { g: SEAS[se][kid ? 'kid' : 'ad'], e: kid ? [...STYLES[styleOf(student)], ...SEAS[se].e.slice(0, 2)] : SEAS[se].e, kid, occ: null };
}

const tileCache = {};
export function tileUri(em, kid) {
  const key = em.join('') + kid; if (tileCache[key]) return tileCache[key];
  const size = kid ? 280 : 340, fs = kid ? 46 : 34, n = kid ? 9 : 6; let t = '';
  for (let i = 0; i < n; i++) {
    const x = ((i * 97 + 23) % (size - 60)) + 10, y = ((i * 61 + 37) % (size - 50)) + fs, r = ((i * 37) % 50) - 25;
    t += `<text x="${x}" y="${y}" transform="rotate(${r} ${x} ${y})">${em[i % em.length]}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><g font-size="${fs}" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${t}</g></svg>`;
  return (tileCache[key] = 'data:image/svg+xml,' + encodeURIComponent(svg));
}

/** 把主题画到页面背景上（#bg）。student 为空（老师、家长、登录页）用淡色的成人版。 */
export function applyTheme(bg, student, today = new Date()) {
  if (!bg) return;
  const th = themeFor(today, student);
  bg.style.background = `linear-gradient(160deg,${th.g[0]},${th.g[1]})`;
  bg.style.setProperty('--tile', `url("${tileUri(th.e, th.kid)}")`);
  bg.dataset.kid = th.kid ? '1' : '0';
}
/** 首页上的节庆问候：{ic, text:[中, 英]}；不在节庆期返回 null。 */
export function festGreeting(today = new Date()) { const o = festival(today); return o ? { ic: FEST[o].ic, n: FEST[o].n } : null; }
