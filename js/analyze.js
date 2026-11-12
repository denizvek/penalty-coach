// ניתוח הבעיטה מתוך רצף נקודות הגוף. פונקציה טהורה (בלי DOM).
//
// frames: [{ t: ms, pose: [33 נקודות מנורמלות] | null, ball: {x,y,w,h} | null }]
// מחזיר: { ok, error?, dir, kickSide, plantSide, contactIdx, L, ballRef, metrics, quality }
//
// סטטוסים של מדד: 'good' (לשבח), 'ok' (בסדר – לא מעירים), בעיה ברורה (short/behind/...),
// או 'na' (לא נמדד – למשל כשהרגל מוסתרת). עדיף לא להעיר מאשר להעיר הערה לא נכונה.

import { CONFIG } from './config.js';
import { SIDES, LM, toU, mid, dist, angle3, median, legLength } from './geom.js';

const A = CONFIG.analysis;
const LEG_PAIRS = [
  [LM.L_HIP, LM.R_HIP], [LM.L_KNEE, LM.R_KNEE], [LM.L_ANK, LM.R_ANK],
  [LM.L_HEEL, LM.R_HEEL], [LM.L_FOOT, LM.R_FOOT],
];

const vis = (p) => p.visibility ?? 1;

// ---------- ניקוי הנתונים ----------

// מודל השלד מחליף לפעמים בין רגל ימין לשמאל בצילום מהצד.
// מחפשים את השיוך (להחליף/לא להחליף בכל פריים) שנותן את התנועה הכי חלקה לאורך כל הרצף:
// תכנון דינמי שממזער את התאוצה של הברכיים והרגליים. כך גם כשהרגליים חולפות זו על פני זו
// ברגע הבעיטה, כל רגל ממשיכה במסלול שלה.
export function fixLegSwaps(fr, aspect) {
  const n = fr.length;
  const key = [[LM.L_KNEE, LM.R_KNEE], [LM.L_ANK, LM.R_ANK], [LM.L_FOOT, LM.R_FOOT]];
  // נקודות הרגליים בפריים i בשיוך s (0 = כמו שהוא, 1 = מוחלף)
  const pts = fr.map((f) => [0, 1].map((sw) => {
    const out = [];
    for (const [l, r] of key) {
      const a = f.pose[sw ? r : l], b = f.pose[sw ? l : r];
      out.push({ x: a.x * aspect, y: a.y }, { x: b.x * aspect, y: b.y });
    }
    return out;
  }));
  const vel = (i, a, b) => pts[i][b].reduce((s, p, k) => s + Math.hypot(p.x - pts[i - 1][a][k].x, p.y - pts[i - 1][a][k].y), 0);
  const acc = (i, a, b, c) => pts[i][c].reduce((s, p, k) => {
    const q = pts[i - 1][b][k], r = pts[i - 2][a][k];
    return s + Math.hypot(p.x - 2 * q.x + r.x, p.y - 2 * q.y + r.y);
  }, 0);
  if (n < 3) return { frames: fr, swaps: 0 };

  // dp[b][c] = עלות מינימלית כשבפריים i-1 השיוך b ובפריים i השיוך c (הפריים הראשון נשאר כמו שהוא)
  const INF = 1e18;
  let dp = [[vel(1, 0, 0) * 0.3, vel(1, 0, 1) * 0.3], [INF, INF]];
  const back = [];
  for (let i = 2; i < n; i++) {
    const nd = [[INF, INF], [INF, INF]];
    const bk = [[0, 0], [0, 0]];
    for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      for (let a = 0; a < 2; a++) {
        if (dp[a][b] >= INF) continue;
        const v = dp[a][b] + acc(i, a, b, c) + 0.3 * vel(i, b, c);
        if (v < nd[b][c]) { nd[b][c] = v; bk[b][c] = a; }
      }
    }
    back.push(bk);
    dp = nd;
  }
  // שחזור המסלול
  let bestB = 0, bestC = 0;
  for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) if (dp[b][c] < dp[bestB][bestC]) { bestB = b; bestC = c; }
  const sw = new Array(n).fill(0);
  sw[n - 1] = bestC; sw[n - 2] = bestB;
  for (let i = n - 1; i >= 2; i--) sw[i - 2] = back[i - 2][sw[i - 1]][sw[i]];

  let swaps = 0;
  const out = fr.map((f, i) => {
    if (!sw[i]) return f;
    swaps++;
    const pose = f.pose.map((p) => ({ ...p }));
    for (const [l, r] of LEG_PAIRS) { pose[l] = { ...f.pose[r] }; pose[r] = { ...f.pose[l] }; }
    return { ...f, pose };
  });
  return { frames: out, swaps };
}

// החלקה: ממוצע משוקלל של 3 פריימים (לפי רמת הביטחון של כל נקודה)
export function smoothPoses(fr) {
  return fr.map((f, i) => {
    const nb = [fr[i - 1], f, fr[i + 1]].filter(Boolean);
    const w = nb.map((g, k) => (g === f ? 2 : 1));
    const pose = f.pose.map((p, j) => {
      let sx = 0, sy = 0, sw = 0;
      nb.forEach((g, k) => {
        const q = g.pose[j];
        const ww = w[k] * Math.max(0.05, vis(q));
        sx += q.x * ww; sy += q.y * ww; sw += ww;
      });
      return { ...p, x: sx / sw, y: sy / sw };
    });
    return { ...f, pose };
  });
}

// ---------- הניתוח ----------

export function analyzeKick(frames, aspect, manualBall = null) {
  const raw = frames.filter((f) => f.pose);
  if (raw.length < 8) return { ok: false, error: 'few-frames' };

  // --- הכדור לפני הבעיטה ---
  let ballRef = manualBall;
  if (!ballRef) {
    const early = raw.slice(0, Math.max(3, Math.floor(raw.length * 0.4))).filter((f) => f.ball);
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

  const { frames: fixed, swaps } = fixLegSwaps(raw, aspect);
  const fr = smoothPoses(fixed);

  // --- אורך רגל (יחידת המידה) ---
  let L = median(fr.map((f) => legLength(f.pose, aspect)));
  if (!Number.isFinite(L) || L <= 0) L = 0.25;

  const P = (f, i) => toU(f.pose[i], aspect);
  const footPt = (f, s) => mid(P(f, SIDES[s].ank), P(f, SIDES[s].foot));
  const hip = (f) => mid(P(f, LM.L_HIP), P(f, LM.R_HIP));
  // ביטחון ממוצע בנקודות נתונות בקבוצת פריימים
  const conf = (list, idx) => (list.length ? median(list.map((f) => Math.min(...idx.map((i) => vis(f.pose[i]))))) : 0);

  // --- כיוון הבעיטה בתמונה ---
  const hip0 = hip(fr[0]);
  let dir = Math.sign(B.x - hip0.x);
  if (Math.abs(B.x - hip0.x) < 0.3 * L) dir = Math.sign(hip(fr[fr.length - 1]).x - hip0.x) || 1;
  const u = (p) => dir * p.x; // מיקום לאורך כיוון הבעיטה
  const uB = u(B);

  // --- רגל הבעיטה ---
  // הכי אמין: הרגע שבו הכדור מתחיל לזוז. באותו רגע רגל הבעיטה נעה מהר ורגל התמיכה עומדת על הקרקע.
  // בלי תזוזת כדור: בודקים לכל רגל את הרגע שבו היא הכי קרובה לכדור – רגל בעיטה מהירה, והשנייה עומדת.
  // אם עדיין לא ברור – מכריעים לפי מי שממשיכה הכי רחוק אחרי הכדור.
  const footSpeed = (s, i) => {
    const a = fr[Math.max(0, i - 1)], b = fr[Math.min(fr.length - 1, i + 1)];
    return dist(footPt(a, s), footPt(b, s)) / L;
  };
  const nearAny = (i) => Math.min(dist(footPt(fr[i], 'left'), B), dist(footPt(fr[i], 'right'), B)) < 1.5 * L;
  let ballMoveIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i].ball;
    if (b && Math.hypot(b.x * aspect - B.x, b.y - B.y) > 3 * rB && nearAny(i)) { ballMoveIdx = i; break; }
  }
  const score = {};
  for (const s of ['left', 'right']) score[s] = Math.max(...fr.map((f) => u(footPt(f, s)) - uB)) / L;
  let decided = false;
  const dbg = {};
  if (ballMoveIdx >= 0) {
    const w = [];
    for (let i = Math.max(0, ballMoveIdx - 3); i <= ballMoveIdx; i++) w.push(i);
    const vL = median(w.map((i) => footSpeed('left', i))), vR = median(w.map((i) => footSpeed('right', i)));
    dbg.vL = vL; dbg.vR = vR; dbg.mv = ballMoveIdx;
    if (vL > 1.3 * vR) { score.left += 100; decided = true; }
    else if (vR > 1.3 * vL) { score.right += 100; decided = true; }
  }
  if (!decided) {
    const evalSide = (s, o) => {
      let idx = 0, bd = 1e9;
      fr.forEach((f, i) => { const d = dist(footPt(f, s), B); if (d < bd) { bd = d; idx = i; } });
      return footSpeed(s, idx) - 2 * footSpeed(o, idx);
    };
    const eL = evalSide('left', 'right'), eR = evalSide('right', 'left');
    dbg.eL = eL; dbg.eR = eR;
    if (eL > 0.05 && eL > eR * 1.5) score.left += 100;
    else if (eR > 0.05 && eR > eL * 1.5) score.right += 100;
  }
  const kickSide = score.left >= score.right ? 'left' : 'right';
  const plantSide = kickSide === 'left' ? 'right' : 'left';
  const ks = SIDES[kickSide], ps = SIDES[plantSide];

  // --- רגע המגע ---
  // אם רואים את הכדור מתחיל לזוז – המגע ממש לפני. אחרת: רגל הבעיטה הכי קרובה לכדור לפני שהיא ממשיכה הלאה.
  let moveIdx = -1;
  for (let i = Math.max(0, ballMoveIdx); ballMoveIdx >= 0 && i < raw.length; i++) {
    if (dist(footPt(fr[i], kickSide), B) < 1.5 * L) { moveIdx = i; break; }
  }
  const passIdx = fr.findIndex((f) => u(footPt(f, kickSide)) > uB + 1.2 * L);
  const end = moveIdx >= 0 ? moveIdx : passIdx >= 0 ? passIdx : fr.length - 1;
  const start = moveIdx >= 0 ? Math.max(0, moveIdx - 6) : 0;
  let contactIdx = start, best = 1e9;
  for (let i = start; i <= end; i++) {
    const d = dist(footPt(fr[i], kickSide), B);
    if (d < best) { best = d; contactIdx = i; }
  }
  if (best > A.maxContactDistL * L) return { ok: false, error: 'no-contact', L, dir, ballRef };

  // כמה פריימים יש סביב הבעיטה – בצילום איטי מדי (מעט פריימים) חלק מהמדדים לא אמינים
  const tC = fr[contactIdx].t;
  const dts = [];
  for (let i = Math.max(1, contactIdx - 5); i <= Math.min(fr.length - 1, contactIdx + 5); i++) dts.push(fr[i].t - fr[i - 1].t);
  const frameGap = median(dts);
  const around = fr.slice(Math.max(0, contactIdx - 1), contactIdx + 2);

  const metrics = {};
  const zone = (v, goodLo, goodHi, okLo, okHi, lowName, highName) => {
    if (!Number.isFinite(v)) return 'na';
    if (v >= goodLo && v <= goodHi) return 'good';
    if (v >= okLo && v <= okHi) return 'ok';
    return v < okLo ? lowName : highName;
  };

  // 1. ריצת תנופה – רק אם הילד עמד במקום בתחילת ההקלטה (אחרת לא ידוע מאיפה התחיל)
  {
    const first = fr.slice(0, 5);
    const moveStart = first.length > 1 ? dist(hip(first[0]), hip(first[first.length - 1])) / L : 0;
    const runup = (uB - u(hip0)) / L;
    const stationary = moveStart < 0.35;
    metrics.runup = {
      value: runup,
      status: stationary ? zone(runup, A.runup.good[0], A.runup.good[1], A.runup.ok[0], A.runup.ok[1], 'short', 'long') : 'na',
      reason: stationary ? '' : 'ההקלטה התחילה כשהילד כבר רץ',
    };
  }

  // 2. הנפת רגל הבעיטה – הכיפוף הגדול ביותר בברך בצעד האחרון לפני המגע.
  // החלון לפי מרחק מהכדור (ולא לפי זמן), כדי שיעבוד גם בהילוך איטי.
  {
    let pre = fr.filter((f, i) => i <= contactIdx && i >= contactIdx - 60 && dist(hip(f), B) < 2.2 * L);
    if (pre.length < 3) pre = fr.slice(Math.max(0, contactIdx - 15), contactIdx + 1);
    const good = pre.filter((f) => Math.min(vis(f.pose[ks.hip]), vis(f.pose[ks.knee]), vis(f.pose[ks.ank])) > A.minVis);
    const angles = good.map((f) => angle3(P(f, ks.hip), P(f, ks.knee), P(f, ks.ank)));
    // לא לוקחים את המינימום המוחלט (רעש) – לוקחים את השני הכי קטן כשיש מספיק
    const sorted = angles.filter(Number.isFinite).sort((a, b) => a - b);
    const v = sorted.length >= 4 ? sorted[1] : sorted[0];
    let status = zone(v, 0, A.backswing.good, 0, A.backswing.ok, 'short', 'short');
    let reason = '';
    if (good.length < 3) { status = 'na'; reason = 'הרגל מוסתרת בתמונה'; }
    else if (pre.length < 4 && status !== 'good') { status = 'na'; reason = 'מעט מדי פריימים – כדאי הילוך איטי'; }
    metrics.backswing = { value: v, status, reason };
  }

  // 3. מיקום רגל התמיכה – כשהיא נחה על הקרקע סביב רגע המגע
  {
    const win = fr.slice(Math.max(0, contactIdx - 2), contactIdx + 2);
    const v = (median(win.map((f) => u(mid(P(f, ps.ank), P(f, ps.heel))))) - uB) / L;
    const c = conf(win, [ps.ank, ps.heel]);
    metrics.plant = {
      value: v,
      status: c < A.minVis ? 'na' : zone(v, A.plant.good[0], A.plant.good[1], A.plant.ok[0], A.plant.ok[1], 'behind', 'ahead'),
      reason: c < A.minVis ? 'הרגל מוסתרת בתמונה' : '',
    };
  }

  // 4. ברך רגל התמיכה ברגע המגע
  {
    const v = median(around.map((f) => angle3(P(f, ps.hip), P(f, ps.knee), P(f, ps.ank))));
    const c = conf(around, [ps.hip, ps.knee, ps.ank]);
    metrics.plantKnee = {
      value: v,
      status: c < A.minVis ? 'na' : zone(v, A.plantKnee.good[0], A.plantKnee.good[1], A.plantKnee.ok[0], A.plantKnee.ok[1], 'deep', 'stiff'),
      reason: c < A.minVis ? 'הרגל מוסתרת בתמונה' : '',
    };
  }

  // 5. הטיית הגו ברגע המגע (חיובי = קדימה, מעל הכדור)
  {
    const v = median(around.map((f) => {
      const sh = mid(P(f, LM.L_SH), P(f, LM.R_SH));
      const hp = hip(f);
      return (Math.atan2(dir * (sh.x - hp.x), hp.y - sh.y) * 180) / Math.PI;
    }));
    const c = conf(around, [LM.L_SH, LM.R_SH, LM.L_HIP, LM.R_HIP]);
    metrics.lean = {
      value: v,
      status: c < A.minVis ? 'na' : zone(v, A.lean.good[0], A.lean.good[1], A.lean.ok[0], A.lean.ok[1], 'back', 'forward'),
      reason: c < A.minVis ? 'הגוף לא נראה טוב' : '',
    };
  }

  // 6. המשך תנועה – כמה רגל הבעיטה ממשיכה קדימה אחרי הכדור
  {
    const post = fr.filter((f, i) => i > contactIdx && i <= contactIdx + 90 && u(hip(f)) - uB < 2.5 * L);
    const good = post.filter((f) => Math.min(vis(f.pose[ks.ank]), vis(f.pose[ks.foot])) > A.minVis);
    if (good.length < 2) {
      metrics.follow = { value: NaN, status: 'na', reason: post.length < 2 ? 'ההקלטה נעצרה מוקדם מדי' : 'הרגל מוסתרת בתמונה' };
    } else {
      const v = Math.max(...good.map((f) => u(footPt(f, kickSide)) - uB)) / L;
      let status = zone(v, A.follow.good, 99, A.follow.ok, 99, 'short', 'short');
      // מעט פריימים אחרי המגע – אולי פספסנו את שיא התנועה, לא מעירים
      if (status === 'short' && good.length < 4) status = 'na';
      metrics.follow = { value: v, status, reason: status === 'na' ? 'מעט מדי פריימים – כדאי הילוך איטי' : '' };
    }
  }

  const applicable = Object.values(metrics).filter((m) => m.status !== 'na');
  const goodCount = applicable.filter((m) => m.status === 'good' || m.status === 'ok').length;

  return {
    ok: true,
    dir,
    kickSide,
    plantSide,
    contactIdx: frames.indexOf(raw[contactIdx]),
    L,
    ballRef,
    metrics,
    poses: fr,
    // השלד אחרי ניקוי (בלי החלפות רגליים ורעש) לכל פריים מקורי – לציור בצפייה החוזרת
    clean: new Map(raw.map((f, i) => [f, fr[i].pose])),
    score: { good: goodCount, total: applicable.length },
    quality: {
      fps: frameGap > 0 ? Math.round(1000 / frameGap) : null,
      swaps,
      frames: fr.length,
      contactT: tC,
      kickDebug: { ...dbg, reachL: score.left % 100, reachR: score.right % 100 },
    },
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
