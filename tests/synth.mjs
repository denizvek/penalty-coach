// יוצר "בעיטה" סינתטית (נקודות גוף) עם פרמטרים ידועים, כדי לבדוק שהניתוח מזהה אותם.
// כל החישובים ביחידות גובה-פריים, ובסוף x מחולק ביחס הרוחב.

export function synthKick({
  aspect = 16 / 9,
  dir = 1,
  ballX = 0.7, // מנורמל
  plantOffL = -0.1, // מיקום רגל התמיכה ביחס לכדור באורכי רגל
  plantKnee = 155,
  backswingKnee = 95,
  leanDeg = 8,
  followL = 1.2,
  runupL = 5,
  fps = 30,
  ballMoves = true,
  plantVis = 0.95, // ביטחון בנקודות רגל התמיכה (לבדיקת רגל מוסתרת)
} = {}) {
  const l = 0.11; // ירך = שוק
  const L = 2 * l;
  const ground = 0.86;
  const torso = 0.16;
  const tc = 1400; // רגע המגע
  const W = aspect;
  const Bx = (dir > 0 ? ballX : 1 - ballX) * W; // ב-U
  const ballR = 0.025;
  const B = { x: Bx, y: ground - ballR };
  const frames = [];

  const knee = (H, A, fwd) => {
    const dx = A.x - H.x, dy = A.y - H.y;
    const d = Math.min(Math.hypot(dx, dy), 2 * l - 1e-6);
    const m = { x: (H.x + A.x) / 2, y: (H.y + A.y) / 2 };
    const h = Math.sqrt(Math.max(0, l * l - (d / 2) ** 2));
    let nx = -dy / d, ny = dx / d; // ניצב
    if (nx * fwd < 0) { nx = -nx; ny = -ny; } // הברך קדימה
    return { x: m.x + nx * h, y: m.y + ny * h };
  };
  const dFromAngle = (deg) => l * Math.sqrt(2 * (1 - Math.cos((deg * Math.PI) / 180)));

  const plantA = { x: Bx + dir * plantOffL * L, y: ground };
  const hipXstart = Bx - dir * runupL * L;
  const hipXc = plantA.x - dir * 0.03;
  const dPlant = dFromAngle(plantKnee);
  const hipYc = ground - Math.sqrt(Math.max(0, dPlant ** 2 - (plantA.x - hipXc) ** 2));
  const hipYrun = ground - dFromAngle(165);

  // מייצרים ב-240 פריימים לשנייה, מחליקים (גוף אמיתי לא "קופץ"), ואז דוגמים לקצב המבוקש
  const HI = 240;
  for (let t = 0; t <= 2200; t += 1000 / HI) {
    const s = Math.min(1, Math.max(0, (t - 400) / (tc - 150 - 400))); // עומד במקום 0.4 שניות ואז רץ
    const hipX = hipXstart + (hipXc - hipXstart) * s + (t > tc ? dir * 0.1 * L * ((t - tc) / 300) : 0);
    const nearC = Math.min(1, Math.max(0, 1 - (Math.abs(t - tc) - 150) / 300));
    const H = { x: hipX, y: hipYrun + (hipYc - hipYrun) * nearC };

    // רגל תמיכה
    let PA;
    if (t >= tc - 250) PA = plantA;
    else PA = { x: hipX + dir * 0.03 * Math.sin(t / 90), y: ground };
    const PK = knee(H, PA, dir);

    // רגל בעיטה
    let KA;
    if (t < tc - 550) KA = { x: hipX - dir * 0.03 * Math.sin(t / 90), y: ground };
    else if (t < tc - 120) {
      const d = dFromAngle(backswingKnee);
      KA = { x: H.x - dir * d * 0.7, y: H.y + d * 0.71 }; // מאחור ולמעלה
    } else if (t <= tc) {
      // תנועת מטוטלת: מעבירים את זווית הברך ואת כיוון השוק בהדרגה (הברך לא מתכופפת יותר מבהנפה)
      const to = { x: B.x - dir * 0.02, y: ground - 0.02 };
      const d1 = Math.hypot(to.x - H.x, to.y - H.y);
      const k1 = (Math.acos(Math.max(-1, Math.min(1, 1 - (d1 * d1) / (2 * l * l)))) * 180) / Math.PI;
      const a0 = Math.atan2(-0.7, 0.71), a1 = Math.atan2(dir * (to.x - H.x), to.y - H.y);
      const p = (t - (tc - 120)) / 120;
      const d = dFromAngle(backswingKnee + (k1 - backswingKnee) * p), a = a0 + (a1 - a0) * p;
      KA = { x: H.x + dir * Math.sin(a) * d, y: H.y + Math.cos(a) * d };
    }
    else {
      const p = Math.min(1, (t - tc) / 300);
      KA = { x: B.x + dir * followL * L * p, y: ground - 0.02 - 0.12 * p };
    }
    const KK = knee(H, KA, dir);

    const lr = (leanDeg * Math.PI) / 180;
    const SH = { x: H.x + dir * Math.sin(lr) * torso, y: H.y - Math.cos(lr) * torso };
    const nose = { x: SH.x + dir * 0.02, y: SH.y - 0.07 };

    const pts = new Array(33).fill(null).map(() => ({ ...SH }));
    const set = (i, p) => (pts[i] = { x: p.x, y: p.y });
    set(0, nose);
    for (let i = 1; i <= 10; i++) set(i, nose);
    set(11, { x: SH.x + 0.005, y: SH.y }); set(12, { x: SH.x - 0.005, y: SH.y });
    set(13, { x: SH.x, y: SH.y + 0.08 }); set(14, { x: SH.x, y: SH.y + 0.08 });
    set(15, { x: SH.x, y: SH.y + 0.15 }); set(16, { x: SH.x, y: SH.y + 0.15 });
    for (let i = 17; i <= 22; i++) set(i, { x: SH.x, y: SH.y + 0.16 });
    // צד שמאל = רגל בעיטה, ימין = רגל תמיכה
    set(23, H); set(24, H);
    set(25, KK); set(26, PK);
    set(27, KA); set(28, PA);
    set(29, { x: KA.x - dir * 0.015, y: KA.y }); set(30, { x: PA.x - dir * 0.015, y: PA.y });
    set(31, { x: KA.x + dir * 0.03, y: KA.y }); set(32, { x: PA.x + dir * 0.03, y: PA.y });

    const pose = pts.map((p, i) => ({ x: p.x / W, y: p.y, z: 0, visibility: [24, 26, 28, 30, 32].includes(i) ? plantVis : 0.95 }));
    let ballPos = { ...B };
    if (ballMoves && t > tc + 30) ballPos = { x: B.x + dir * (t - tc) * 0.002, y: B.y - (t - tc) * 0.0003 };
    const ball = ballPos.x > 0 && ballPos.x < W ? { x: ballPos.x / W, y: ballPos.y, w: (2 * ballR) / W, h: 2 * ballR } : null;
    frames.push({ t, pose, ball });
  }
  const half = 12; // ~50ms לכל צד
  const smooth = frames.map((f, i) => {
    const nb = frames.slice(Math.max(0, i - half), i + half + 1);
    const pose = f.pose.map((p, j) => ({
      ...p,
      x: nb.reduce((s, g) => s + g.pose[j].x, 0) / nb.length,
      y: nb.reduce((s, g) => s + g.pose[j].y, 0) / nb.length,
    }));
    return { ...f, pose };
  });
  const step = HI / fps;
  const out = [];
  for (let k = 0; k < smooth.length; k += step) out.push(smooth[Math.round(k)]);
  return { frames: out.filter(Boolean), aspect, tc };
}
