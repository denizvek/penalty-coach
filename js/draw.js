// ציור שלד, כדור וסימונים על קנבס. rect = האזור שבו מוצג הפריים {x,y,w,h}.

import { SIDES, LM, mid } from './geom.js';

const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
];
const LEG = (s) => [[s.hip, s.knee], [s.knee, s.ank], [s.ank, s.heel], [s.heel, s.foot], [s.ank, s.foot]];

export const COLORS = {
  body: '#e8f5e9',
  kick: '#ffca28',
  plant: '#4fc3f7',
  ball: '#ff7043',
  good: '#66bb6a',
  bad: '#ef5350',
};

export function drawSkeleton(ctx, lm, rect, { kickSide = null, alpha = 1, scale = 1 } = {}) {
  if (!lm) return;
  const P = (i) => ({ x: rect.x + lm[i].x * rect.w, y: rect.y + lm[i].y * rect.h });
  const lw = Math.max(2, rect.h / 160) * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  const line = (a, b, color, w = lw) => {
    if ((lm[a].visibility ?? 1) < 0.25 || (lm[b].visibility ?? 1) < 0.25) return;
    const p = P(a), q = P(b);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  };
  for (const [a, b] of BONES) line(a, b, COLORS.body);
  for (const side of ['left', 'right']) {
    const color = kickSide ? (side === kickSide ? COLORS.kick : COLORS.plant) : COLORS.body;
    for (const [a, b] of LEG(SIDES[side])) line(a, b, color, lw * 1.3);
  }
  // ראש
  const n = P(LM.NOSE);
  const sh = mid(P(LM.L_SH), P(LM.R_SH));
  const r = Math.max(4, Math.hypot(n.x - sh.x, n.y - sh.y) * 0.45);
  ctx.strokeStyle = COLORS.body;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawBall(ctx, ball, rect, { manual = false, label = '' } = {}) {
  if (!ball) return;
  const cx = rect.x + ball.x * rect.w, cy = rect.y + ball.y * rect.h;
  const r = Math.max(10, (ball.h * rect.h) / 2 + 6);
  ctx.save();
  ctx.strokeStyle = COLORS.ball;
  ctx.lineWidth = 3;
  if (manual) ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (label) {
    ctx.fillStyle = COLORS.ball;
    ctx.font = `bold ${Math.max(12, rect.h / 30)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy - r - 6);
  }
  ctx.restore();
}

// סימונים ברגע הבעיטה: קו הכדור, רגל התמיכה וקו הגו
export function drawContactMarks(ctx, frame, result, rect) {
  if (!frame?.pose || !result?.ok) return;
  const lm = frame.pose;
  const X = (x) => rect.x + x * rect.w, Y = (y) => rect.y + y * rect.h;
  ctx.save();
  // קו אנכי במרכז הכדור
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = COLORS.ball;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(result.ballRef.x), Y(result.ballRef.y) - rect.h * 0.35);
  ctx.lineTo(X(result.ballRef.x), Y(result.ballRef.y) + rect.h * 0.05);
  ctx.stroke();
  ctx.setLineDash([]);
  // רגל התמיכה
  const ps = SIDES[result.plantSide];
  const ok = result.metrics.plant.status === 'good';
  ctx.fillStyle = ok ? COLORS.good : COLORS.bad;
  ctx.beginPath();
  ctx.arc(X(lm[ps.ank].x), Y(lm[ps.ank].y), Math.max(6, rect.h / 60), 0, Math.PI * 2);
  ctx.fill();
  // קו הגו
  const sh = mid(lm[LM.L_SH], lm[LM.R_SH]), hp = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  ctx.strokeStyle = result.metrics.lean.status === 'good' ? COLORS.good : COLORS.bad;
  ctx.lineWidth = Math.max(3, rect.h / 120);
  ctx.beginPath();
  ctx.moveTo(X(hp.x), Y(hp.y));
  ctx.lineTo(X(hp.x + (sh.x - hp.x) * 1.4), Y(hp.y + (sh.y - hp.y) * 1.4));
  ctx.stroke();
  ctx.restore();
}

// חישוב האזור שבו מוצג וידאו בגודל vw×vh בתוך מיכל cw×ch (object-fit: contain)
export function containRect(vw, vh, cw, ch) {
  const s = Math.min(cw / vw, ch / vh);
  const w = vw * s, h = vh * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}
