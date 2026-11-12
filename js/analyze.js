// ניתוח הבעיטה מתוך רצף נקודות הגוף. פונקציה טהורה (בלי DOM).
//
// frames: [{ t: ms, pose: [33 נקודות מנורמלות] | null, ball: {x,y,w,h} | null }]
// מחזיר: { ok, error?, dir, kickSide, plantSide, contactIdx, L, ballRef, metrics: {...} }

import { CONFIG } from './config.js';
import { SIDES, LM, toU, mid, dist, angle3, median, legLength } from './geom.js';

const A = CONFIG.analysis;

export function analyzeKick(frames, aspect, manualBall = null) {
  const fr = frames.filter((f) => f.pose);
  if (fr.length < 8) return { ok: false, error: 'few-frames' };

  // --- הכדור לפני הבעיטה ---
  let ballRef = manualBall;
  if (!ballRef) {
    const early = fr.slice(0, Math.max(3, Math.floor(fr.length * 0.4))).filter((f) => f.ball);
    if (early.length) {
      ballRef = {
        x: median(early.map((f) => f.ball.x)),
        y: median(early.map((f) => f.ball.y)),
        w: median(early.map((f) => f.ball.w)),
        h: median(early.map((f) => f.ball.h)),
      };
    }
  }
  if (!ballRef) return { ok: false, error: 'no-ball' };
  const B = { x: ballRef.x * aspect, y: ballRef.y };
  const rB = Math.max(0.005, ballRef.h / 2);

  // --- אורך רגל (יחידת המידה) ---
  let L = median(fr.map((f) => legLength(f.pose, aspect)));
  if (!Number.isFinite(L) || L <= 0) L = 0.25;

  const P = (f, i) => toU(f.pose[i], aspect);
  const footPt = (f, s) => mid(P(f, SIDES[s].ank), P(f, SIDES[s].foot));
  const hip = (f) => mid(P(f, LM.L_HIP), P(f, LM.R_HIP));

  // --- כיוון הבעיטה בתמונה ---
  const hip0 = hip(fr[0]);
  let dir = Math.sign(B.x - hip0.x);
  if (Math.abs(B.x - hip0.x) < 0.3 * L) dir = Math.sign(hip(fr[fr.length - 1]).x - hip0.x) || 1;
  const u = (p) => dir * p.x; // מיקום לאורך כיוון הבעיטה
  const uB = u(B);

  // --- רגל הבעיטה: זו שמגיעה הכי רחוק אחרי הכדור ---
  const reach = { left: -1e9, right: -1e9 };
  for (const f of fr) for (const s of ['left', 'right']) reach[s] = Math.max(reach[s], u(footPt(f, s)) - uB);
  const kickSide = reach.left >= reach.right ? 'left' : 'right';
  const plantSide = kickSide === 'left' ? 'right' : 'left';

  // --- רגע המגע ---
  // אם הכדור נראה זז – המגע לפני תזוזתו. אחרת: הנקודה הקרובה ביותר לכדור לפני שהרגל ממשיכה הלאה.
  let moveIdx = -1;
  for (let i = 0; i < fr.length; i++) {
    const b = fr[i].ball;
    if (b && Math.hypot(b.x * aspect - B.x, b.y - B.y) > 3 * rB) {
      // דורשים שהרגל כבר קרובה, כדי לא להתבלבל מזיהוי שגוי
      if (dist(footPt(fr[i], kickSide), B) < 1.5 * L) { moveIdx = i; break; }
    }
  }
  let passIdx = fr.findIndex((f) => u(footPt(f, kickSide)) > uB + 1.2 * L);
  let end = moveIdx >= 0 ? moveIdx : passIdx >= 0 ? passIdx : fr.length - 1;
  let contactIdx = 0, best = 1e9;
  for (let i = 0; i <= end; i++) {
    const d = dist(footPt(fr[i], kickSide), B);
    if (d < best) { best = d; contactIdx = i; }
  }
  if (best > A.maxContactDistL * L) {
    return { ok: false, error: 'no-contact', L, dir, ballRef };
  }
  const c = fr[contactIdx];

  // --- מדדים ---
  const metrics = {};

  // 1. ריצת תנופה: מרחק האגן מהכדור בתחילת ההקלטה
  const runup = (uB - u(hip0)) / L;
  metrics.runup = {
    value: runup,
    status: runup < A.runupMinL ? 'short' : runup > A.runupMaxL ? 'long' : 'good',
  };

  // 2. הנפת רגל הבעיטה: הזווית הקטנה ביותר בברך בצעד האחרון לפני המגע.
  // החלון נקבע לפי מרחק מהכדור ולא לפי זמן, כדי שיעבוד גם בסרטון בהילוך איטי.
  const ks = SIDES[kickSide];
  let pre = fr.filter((f, i) => i <= contactIdx && dist(hip(f), B) < 2.2 * L);
  if (pre.length < 3) pre = fr.slice(Math.max(0, contactIdx - 15), contactIdx + 1);
  const kneeAngles = pre
    .filter((f) => Math.min(f.pose[ks.hip].visibility ?? 1, f.pose[ks.knee].visibility ?? 1, f.pose[ks.ank].visibility ?? 1) > 0.3)
    .map((f) => angle3(P(f, ks.hip), P(f, ks.knee), P(f, ks.ank)));
  const minKnee = kneeAngles.length ? Math.min(...kneeAngles) : NaN;
  metrics.backswing = {
    value: minKnee,
    status: !Number.isFinite(minKnee) ? 'na' : minKnee <= A.backswingGoodDeg ? 'good' : 'short',
  };

  // 3. מיקום רגל התמיכה ביחס לכדור (ממוצע סביב המגע)
  const ps = SIDES[plantSide];
  const around = fr.slice(Math.max(0, contactIdx - 1), contactIdx + 2);
  const plantU = median(around.map((f) => u(P(f, ps.ank)))) - uB;
  const plant = plantU / L;
  metrics.plant = {
    value: plant,
    status: plant < A.plantMinL ? 'behind' : plant > A.plantMaxL ? 'ahead' : 'good',
  };

  // 4. ברך רגל התמיכה ברגע המגע
  const plantKnee = median(around.map((f) => angle3(P(f, ps.hip), P(f, ps.knee), P(f, ps.ank))));
  metrics.plantKnee = {
    value: plantKnee,
    status: !Number.isFinite(plantKnee) ? 'na' : plantKnee > A.plantKneeMax ? 'stiff' : plantKnee < A.plantKneeMin ? 'deep' : 'good',
  };

  // 5. הטיית הגו ברגע המגע (חיובי = קדימה, מעל הכדור)
  const leans = around.map((f) => {
    const sh = mid(P(f, LM.L_SH), P(f, LM.R_SH));
    const hp = hip(f);
    return (Math.atan2(dir * (sh.x - hp.x), hp.y - sh.y) * 180) / Math.PI;
  });
  const lean = median(leans);
  metrics.lean = {
    value: lean,
    status: lean < A.leanMinDeg ? 'back' : lean > A.leanMaxDeg ? 'forward' : 'good',
  };

  // 6. המשך תנועה: כמה רגל הבעיטה ממשיכה קדימה אחרי הכדור
  const post = fr.filter((f, i) => i > contactIdx && i <= contactIdx + 90 && u(hip(f)) - uB < 2.5 * L);
  if (post.length < 2) {
    metrics.follow = { value: NaN, status: 'na' };
  } else {
    const follow = Math.max(...post.map((f) => u(footPt(f, kickSide)) - uB)) / L;
    metrics.follow = { value: follow, status: follow >= A.followGoodL ? 'good' : 'short' };
  }

  const applicable = Object.values(metrics).filter((m) => m.status !== 'na');
  const goodCount = applicable.filter((m) => m.status === 'good').length;

  return {
    ok: true,
    dir,
    kickSide,
    plantSide,
    contactIdx: frames.indexOf(c),
    L,
    ballRef,
    metrics,
    score: { good: goodCount, total: applicable.length },
  };
}

// מעקב חי: האם כבר הייתה בעיטה? (הכדור זז, או רגל עברה את הכדור)
// dir = כיוון הבעיטה בתמונה (+1 ימינה, -1 שמאלה), נקבע ברגע שמתחילים להקליט
export function kickHappened(frame, aspect, ballRef, L, dir) {
  if (!frame.pose || !ballRef) return false;
  const leg = Number.isFinite(L) && L > 0 ? L : 0.25;
  const B = { x: ballRef.x * aspect, y: ballRef.y };
  const hp = mid(toU(frame.pose[LM.L_HIP], aspect), toU(frame.pose[LM.R_HIP], aspect));
  if (dist(hp, B) > 2 * leg) return false; // הילד עוד רחוק מהכדור
  if (frame.ball) {
    const moved = Math.hypot(frame.ball.x * aspect - B.x, frame.ball.y - B.y);
    if (moved > Math.max(0.04, ballRef.h * 2)) return true;
  }
  for (const s of ['left', 'right']) {
    const f = mid(toU(frame.pose[SIDES[s].ank], aspect), toU(frame.pose[SIDES[s].foot], aspect));
    if (dir * (f.x - B.x) > 0.8 * leg) return true;
  }
  return false;
}
