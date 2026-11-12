// הרצה: node tests/run-tests.mjs
import { synthKick } from './synth.mjs';
import { analyzeKick, kickHappened } from '../js/analyze.js';
import { evaluateFraming } from '../js/framing.js';
import { buildFeedback } from '../js/feedback.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failed++;
};
const fmt = (r) => Object.entries(r.metrics).map(([k, m]) => `${k}=${m.status}(${Number(m.value).toFixed(2)})`).join(' ');

function expect(name, params, expected) {
  const { frames, aspect, tc } = synthKick(params);
  const r = analyzeKick(frames, aspect);
  if (!r.ok) return check(name, false, 'error=' + r.error);
  const bad = Object.entries(expected).filter(([k, v]) => r.metrics[k].status !== v);
  const contactT = frames[r.contactIdx].t;
  check(name, bad.length === 0 && Math.abs(contactT - tc) <= 100 && r.kickSide === 'left', fmt(r) + ` contact=${Math.round(contactT)}ms`);
  return r;
}

console.log('— ניתוח בעיטה —');
const good = expect('בעיטה טובה, לימין', {}, { runup: 'good', backswing: 'good', plant: 'good', plantKnee: 'good', lean: 'good', follow: 'good' });
expect('בעיטה טובה, לשמאל', { dir: -1 }, { runup: 'good', plant: 'good', lean: 'good', follow: 'good' });
expect('רגל תמיכה רחוקה מאחור', { plantOffL: -0.8 }, { plant: 'behind' });
expect('רגל תמיכה לפני הכדור', { plantOffL: 0.45 }, { plant: 'ahead' });
expect('נשען אחורה', { leanDeg: -18 }, { lean: 'back' });
expect('הנפה קצרה', { backswingKnee: 179 }, { backswing: 'short' });
expect('הנפה בינונית = בסדר, בלי הערה', { backswingKnee: 150 }, { backswing: 'ok' });
expect('ברך תמיכה נעולה', { plantKnee: 179.8 }, { plantKnee: 'stiff' });
expect('בלי המשך תנועה', { followL: 0.3 }, { follow: 'short' });
expect('ריצה קצרה', { runupL: 1.5 }, { runup: 'short' });
expect('כדור לא זז בזיהוי', { ballMoves: false }, { plant: 'good', lean: 'good' });

console.log('— עמידות לרעש —');
// רעש בנקודות + החלפת ימין/שמאל אקראית ב-25% מהפריימים (כמו שקורה במודל אמיתי)
function corrupt(frames, seed = 7) {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const pairs = [[23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
  return frames.map((f) => {
    const pose = f.pose.map((p) => ({ ...p, x: p.x + (rnd() - 0.5) * 0.006, y: p.y + (rnd() - 0.5) * 0.01 }));
    if (rnd() < 0.25) for (const [a, b] of pairs) { const t = pose[a]; pose[a] = pose[b]; pose[b] = t; }
    return { ...f, pose };
  });
}
for (const [name, params, exp] of [
  ['בעיטה טובה עם רעש והחלפות רגליים', {}, { plant: 'good', lean: 'good', follow: 'good' }],
  ['רגל תמיכה מאחור עם רעש', { plantOffL: -0.8 }, { plant: 'behind' }],
  ['נשען אחורה עם רעש', { leanDeg: -20 }, { lean: 'back' }],
]) {
  const { frames, aspect } = synthKick(params);
  const r = analyzeKick(corrupt(frames), aspect);
  const bad = r.ok ? Object.entries(exp).filter(([k, v]) => r.metrics[k].status !== v) : [['error', r.error]];
  check(name, bad.length === 0 && r.kickSide === 'left', r.ok ? fmt(r) + ` swaps=${r.quality.swaps}` : r.error);
}
{
  const { frames, aspect } = synthKick({ plantVis: 0.2, plantOffL: -0.8 });
  const r = analyzeKick(frames, aspect);
  check('רגל תמיכה מוסתרת → לא מעירים עליה', r.ok && r.metrics.plant.status === 'na' && r.metrics.plantKnee.status === 'na', r.ok ? fmt(r) : r.error);
}
{
  // צילום איטי מדי (8 פריימים בשנייה): לא להעיר הערות שגויות על הנפה/המשך
  const { frames, aspect } = synthKick({ fps: 8 });
  const r = analyzeKick(frames, aspect);
  const wrong = r.ok ? ['backswing', 'follow'].filter((k) => !['good', 'ok', 'na'].includes(r.metrics[k].status)) : ['error'];
  check('מעט פריימים → בלי הערות שגויות', wrong.length === 0, r.ok ? fmt(r) + ` fps=${r.quality.fps}` : r.error);
}

const fb = buildFeedback(good, { gender: 'f', name: 'נועה' });
check('משוב נבנה', fb.speech.includes('מה היה טוב') && fb.speech.includes('נועה'), fb.speech.slice(0, 60) + '…');

console.log('— זיהוי בעיטה חי —');
{
  const { frames, aspect, tc } = synthKick({});
  const ballRef = frames[0].ball;
  const idx = frames.findIndex((f) => kickHappened(f, aspect, ballRef, 0.22, 1));
  check('מזהה את הבעיטה סמוך לרגע המגע', idx >= 0 && frames[idx].t >= tc - 50 && frames[idx].t <= tc + 400, `t=${idx >= 0 ? Math.round(frames[idx].t) : '-'}`);
  check('לא מזהה בעיטה בתחילת הריצה', !kickHappened(frames[0], aspect, ballRef, 0.22, 1));
}

console.log('— עוזר כיוון —');
{
  const { frames, aspect } = synthKick({});
  const f0 = frames[0];
  const ok = evaluateFraming({ pose: f0.pose, ball: f0.ball, aspect, sensors: { roll: 2, shake: 5 }, brightness: 120 });
  check('פריים תקין = מוכן', ok.ready, ok.instruction.text);
  const portrait = evaluateFraming({ pose: f0.pose, ball: f0.ball, aspect: 9 / 16 });
  check('טלפון לאורך → לסובב', portrait.instruction.arrow === 'rotate', portrait.instruction.text);
  const noBall = evaluateFraming({ pose: f0.pose, ball: null, aspect });
  check('אין כדור → הוראה על הכדור', noBall.instruction.text.includes('כדור'), noBall.instruction.text);
  // הכדור קרוב מדי לקצה הימני → המצלם צריך לזוז ימינה
  const shift = 0.2;
  const pose = f0.pose.map((p) => ({ ...p, x: p.x + shift }));
  const ball = { ...f0.ball, x: f0.ball.x + shift };
  const edge = evaluateFraming({ pose, ball, aspect });
  check('כדור בקצה → זוז ימינה', edge.instruction.arrow === 'right', edge.instruction.text);
  const mir = evaluateFraming({ pose, ball, aspect, mirrored: true });
  check('מצלמה קדמית → כיוון הפוך', mir.instruction.arrow === 'left', mir.instruction.text);
  // ילד גדול מדי
  const big = f0.pose.map((p) => ({ ...p, y: 0.5 + (p.y - 0.6) * 2.2 }));
  const close = evaluateFraming({ pose: big, ball: f0.ball, aspect });
  check('קרוב מדי → להתרחק', close.instruction.arrow === 'back' || close.instruction.text.includes('התרחק') || close.instruction.arrow === 'up' || close.instruction.arrow === 'down', close.instruction.text);
  const tilt = evaluateFraming({ pose: f0.pose, ball: f0.ball, aspect, sensors: { roll: 15, shake: 0 } });
  check('טלפון עקום → ליישר', tilt.instruction.arrow === 'level', tilt.instruction.text);
}

console.log(failed ? `\n${failed} בדיקות נכשלו` : '\nכל הבדיקות עברו');
process.exit(failed ? 1 : 0);
