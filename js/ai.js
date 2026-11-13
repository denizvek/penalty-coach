// "המאמן החכם": בוחר 5 פריימים מרכזיים מהבעיטה, חותך סביב הילד והכדור, מצייר עליהם את השלד,
// ושולח לפונקציית השרת שמעבירה אותם למודל הראייה של Claude. מחזיר משוב מאמן בעברית.

import { CONFIG } from './config.js';
import { SIDES, LM, toU, mid, dist, angle3, bodyBox } from './geom.js';
import { drawSkeleton, drawBall } from './draw.js';

export const aiConfigured = () => !!CONFIG.aiEndpoint;

// בחירת הפריימים לפי מצב הגוף (ולא לפי זמן), כדי שיעבוד גם בהילוך איטי
export function pickKeyFrames(frames, result, aspect) {
  const list = frames
    .map((f, i) => ({ f, i, pose: result.clean?.get(f) || f.pose }))
    .filter((x) => x.pose);
  const ci = list.findIndex((x) => x.i === result.contactIdx);
  if (ci < 0) return [];
  const B = { x: result.ballRef.x * aspect, y: result.ballRef.y };
  const L = result.L;
  const P = (x, k) => toU(x.pose[k], aspect);
  const hip = (x) => mid(P(x, LM.L_HIP), P(x, LM.R_HIP));
  const ks = SIDES[result.kickSide];
  const u = (p) => result.dir * p.x;

  const before = list.slice(0, ci);
  const after = list.slice(ci + 1);
  const closest = (arr, fn) => arr.reduce((a, b) => (fn(b) < fn(a) ? b : a), arr[0]);

  const picks = [];
  // 1. ריצת התנופה – כשהאגן בערך 2.5 אורכי רגל מהכדור
  if (before.length) picks.push({ x: closest(before, (x) => Math.abs(dist(hip(x), B) - 2.5 * L)), label: 'ריצת תנופה' });
  // 2. הנפה – הברך של רגל הבעיטה הכי כפופה בצעד האחרון
  const near = before.filter((x) => dist(hip(x), B) < 2.2 * L);
  if (near.length) {
    picks.push({ x: closest(near, (x) => angle3(P(x, ks.hip), P(x, ks.knee), P(x, ks.ank)) || 999), label: 'הנפת רגל הבעיטה, רגל התמיכה נוחתת' });
  }
  // 3. רגע הבעיטה
  picks.push({ x: list[ci], label: 'רגע הפגיעה בכדור' });
  // 4. המשך תנועה – הרגל הכי רחוק קדימה
  if (after.length) {
    const fwd = after.filter((x) => u(hip(x)) - u(B) < 2.5 * L);
    if (fwd.length) {
      const ft = (x) => -u(mid(P(x, ks.ank), P(x, ks.foot)));
      picks.push({ x: closest(fwd, ft), label: 'המשך התנועה אחרי הבעיטה' });
    }
    // 5. סיום – יציבות אחרי הבעיטה
    picks.push({ x: after[Math.min(after.length - 1, Math.max(0, Math.round(after.length * 0.8)))], label: 'סיום התנועה' });
  }
  // בלי כפולים, לפי סדר הזמן
  const seen = new Set();
  return picks
    .filter((p) => p.x && !seen.has(p.x.i) && seen.add(p.x.i))
    .sort((a, b) => a.x.i - b.x.i)
    .map((p) => ({ frame: p.x.f, pose: p.x.pose, label: p.label }));
}

// אזור חיתוך משותף לכל הפריימים: הילד + הכדור + שוליים
function cropBox(keys, ballRef) {
  let minX = ballRef.x - ballRef.w, maxX = ballRef.x + ballRef.w, minY = ballRef.y - ballRef.h, maxY = ballRef.y + ballRef.h;
  for (const k of keys) {
    const b = bodyBox(k.pose);
    if (!b) continue;
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
  }
  const padX = (maxX - minX) * 0.12, padY = (maxY - minY) * 0.12;
  return {
    x0: Math.max(0, minX - padX), x1: Math.min(1, maxX + padX),
    y0: Math.max(0, minY - padY), y1: Math.min(1, maxY + padY),
  };
}

function renderKey(k, box, result) {
  const snap = k.frame.snap;
  const sx = box.x0 * snap.width, sy = box.y0 * snap.height;
  const sw = (box.x1 - box.x0) * snap.width, sh = (box.y1 - box.y0) * snap.height;
  const scale = Math.min(CONFIG.aiImageMax / sw, CONFIG.aiImageMax / sh, 3);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(snap, sx, sy, sw, sh, 0, 0, c.width, c.height);
  // קואורדינטות השלד מנורמלות לפריים המלא – ממקמים את הפריים המלא כך שהחיתוך ימלא את הקנבס
  const rect = { x: -sx * scale, y: -sy * scale, w: snap.width * scale, h: snap.height * scale };
  drawSkeleton(ctx, k.pose, rect, { kickSide: result.kickSide, alpha: 0.75, scale: 0.7 });
  drawBall(ctx, k.frame.ball || result.ballRef, rect);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
}

export async function reviewKick(frames, result, aspect, settings) {
  if (!aiConfigured()) throw new Error('not-configured');
  const keys = pickKeyFrames(frames, result, aspect).filter((k) => k.frame.snap);
  if (keys.length < 2) throw new Error('few-frames');
  const box = cropBox(keys, result.ballRef);
  const payload = {
    frames: keys.map((k) => ({ label: k.label, image: renderKey(k, box, result) })),
    metrics: Object.fromEntries(
      Object.entries(result.metrics).map(([id, m]) => [id, { value: Number.isFinite(m.value) ? +m.value.toFixed(2) : null, status: m.status }]),
    ),
    kickSide: result.kickSide,
    gender: settings.gender,
    name: settings.name,
    age: settings.age || '',
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.aiTimeoutMs);
  try {
    const res = await fetch(CONFIG.aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `http-${res.status}`);
    return { feedback: data.feedback, images: payload.frames };
  } catch (e) {
    throw new Error(ctrl.signal.aborted ? 'timeout' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

export function aiSpeech(fb) {
  const parts = [fb.opener];
  if (fb.good?.length) parts.push('מה היה טוב: ' + fb.good.join('. וגם, ') + '.');
  if (fb.improve?.length) parts.push('מה לשפר: ' + fb.improve.join('. וגם, ') + '.');
  if (fb.keep) parts.push('על מה לשמור: ' + fb.keep);
  return parts.join(' ');
}
