// עזרי גיאומטריה. כל החישובים נעשים ביחידות של "גובה פריים":
// x מוכפל ביחס הרוחב/גובה, כך שזוויות ומרחקים נכונים גם בפריים רחב.

export const LM = {
  NOSE: 0,
  L_SH: 11, R_SH: 12,
  L_EL: 13, R_EL: 14,
  L_WR: 15, R_WR: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANK: 27, R_ANK: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_FOOT: 31, R_FOOT: 32,
};

export const SIDES = {
  left: { hip: LM.L_HIP, knee: LM.L_KNEE, ank: LM.L_ANK, heel: LM.L_HEEL, foot: LM.L_FOOT, sh: LM.L_SH },
  right: { hip: LM.R_HIP, knee: LM.R_KNEE, ank: LM.R_ANK, heel: LM.R_HEEL, foot: LM.R_FOOT, sh: LM.R_SH },
};

export const toU = (p, aspect) => ({ x: p.x * aspect, y: p.y, v: p.visibility ?? 1 });
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// זווית בנקודה b (במעלות) בין a-b-c
export function angle3(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (d === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / d));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function median(arr) {
  const a = arr.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// מסגרת סביב נקודות הגוף הנראות (בקואורדינטות מנורמלות 0..1)
export function bodyBox(lm, minVis = 0.3) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, n = 0;
  for (const p of lm) {
    if ((p.visibility ?? 1) < minVis) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    n++;
  }
  if (n < 8) return null;
  // האף לא בקצה הראש – מוסיפים שוליים מעליו
  const h = maxY - minY;
  return { minX, maxX, minY: minY - h * 0.1, maxY, cx: (minX + maxX) / 2, h: h * 1.1 };
}

export function hipCenter(lm) {
  return mid(lm[LM.L_HIP], lm[LM.R_HIP]);
}

// אורך רגל ממוצע (ירך-ברך-קרסול) ביחידות גובה פריים
export function legLength(lm, aspect) {
  const vals = [];
  for (const s of Object.values(SIDES)) {
    const h = toU(lm[s.hip], aspect), k = toU(lm[s.knee], aspect), a = toU(lm[s.ank], aspect);
    if (Math.min(h.v, k.v, a.v) < 0.4) continue;
    vals.push(dist(h, k) + dist(k, a));
  }
  return vals.length ? vals.reduce((x, y) => x + y) / vals.length : NaN;
}
