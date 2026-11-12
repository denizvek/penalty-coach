// עוזר הכיוון: בודק אם המצלם עומד במקום הנכון ומחזיר הוראה אחת ברורה.
// פונקציה טהורה (בלי DOM) כדי שאפשר יהיה לבדוק אותה.

import { CONFIG } from './config.js';
import { LM, bodyBox, mid } from './geom.js';

// סדר הבדיקות = סדר העדיפות של ההוראות
export const CHECK_LABELS = {
  landscape: 'טלפון לרוחב',
  kid: 'ילד בתמונה',
  distance: 'מרחק',
  ball: 'כדור',
  room: 'מקום לריצה ולבעיטה',
  side: 'צילום מהצד',
  steady: 'טלפון ישר ויציב',
  light: 'תאורה',
};

/**
 * @param {object} s
 * @param {Array|null} s.pose  נקודות הגוף המנורמלות (33)
 * @param {{x,y,w,h}|null} s.ball מרכז ומידות הכדור (מנורמלים)
 * @param {number} s.aspect רוחב/גובה של הפריים
 * @param {boolean} [s.mirrored] מצלמה קדמית (ימין ושמאל הפוכים)
 * @param {{roll:number|null, shake:number}} [s.sensors]
 * @param {number} [s.brightness] 0..255
 * @param {'m'|'f'} [s.gender]
 */
export function evaluateFraming(s) {
  const F = CONFIG.framing;
  const g = (m, f) => (s.gender === 'f' ? f : m);
  const checks = {};
  const fail = (id, text, arrow = null) => {
    checks[id] = { ok: false, text, arrow };
  };
  const pass = (id) => {
    if (!checks[id]) checks[id] = { ok: true };
  };

  // כיוון תנועת המצלם שמזיז את התמונה: מצלמה זזה ימינה => העצמים זזים שמאלה בתמונה
  const camMove = (sign) => {
    const right = s.mirrored ? sign < 0 : sign > 0;
    return right
      ? { text: g('זוז קצת ימינה', 'זוזי קצת ימינה'), arrow: 'right' }
      : { text: g('זוז קצת שמאלה', 'זוזי קצת שמאלה'), arrow: 'left' };
  };

  // 1. טלפון לרוחב
  if (s.aspect < 1) fail('landscape', g('סובב את הטלפון לרוחב', 'סובבי את הטלפון לרוחב'), 'rotate');
  else pass('landscape');

  // 2. ילד בתמונה
  const box = s.pose ? bodyBox(s.pose) : null;
  if (!box) {
    fail('kid', g('לא רואה את הילד. כוון את המצלמה אליו', 'לא רואה את הילד. כווני את המצלמה אליו'), null);
  } else {
    const cutTop = box.minY < F.edgeMargin;
    const cutBottom = box.maxY > 1 - F.edgeMargin;
    const cutLeft = box.minX < F.edgeMargin;
    const cutRight = box.maxX > 1 - F.edgeMargin;
    if ((cutTop && cutBottom) || (cutLeft && cutRight)) {
      fail('kid', g('התרחק כמה צעדים', 'התרחקי כמה צעדים'), 'back');
    } else if (cutTop) {
      fail('kid', g('הרם מעט את הטלפון, הראש חתוך', 'הרימי מעט את הטלפון, הראש חתוך'), 'up');
    } else if (cutBottom) {
      fail('kid', g('הנמך מעט את הטלפון, הרגליים חתוכות', 'הנמיכי מעט את הטלפון, הרגליים חתוכות'), 'down');
    } else if (cutLeft) {
      const m = camMove(-1);
      fail('kid', m.text, m.arrow);
    } else if (cutRight) {
      const m = camMove(1);
      fail('kid', m.text, m.arrow);
    } else pass('kid');

    // 3. מרחק
    if (box.h > F.maxKidHeight) fail('distance', g('התרחק 2–3 צעדים', 'התרחקי 2–3 צעדים'), 'back');
    else if (box.h < F.minKidHeight) fail('distance', g('התקרב כמה צעדים', 'התקרבי כמה צעדים'), 'forward');
    else pass('distance');
  }

  // 4. כדור
  if (!s.ball) {
    fail('ball', 'לא רואה את הכדור. ' + g('ודא שהוא בתמונה, או הקש עליו במסך', 'ודאי שהוא בתמונה, או הקישי עליו במסך'), null);
  } else pass('ball');

  // 5. מקום לריצה ולהמשך הבעיטה + 6. צילום מהצד
  if (box && s.ball) {
    const dir = Math.sign(s.ball.x - box.cx) || 1; // לאיזה כיוון בתמונה הילד בועט
    const u = (x) => (dir > 0 ? x : 1 - x); // מיקום לאורך כיוון הבעיטה
    const ballLead = u(s.ball.x) + (s.ball.w / 2);
    const kidBack = dir > 0 ? box.minX : 1 - box.maxX;
    const needMoreFront = ballLead > F.ballMaxLead; // אין מקום להמשך תנועה אחרי הכדור
    const needMoreBack = kidBack < F.edgeMargin + 0.02;
    if (needMoreFront && needMoreBack) {
      fail('room', g('התרחק קצת, צריך לראות גם את הריצה וגם את ההמשך אחרי הכדור', 'התרחקי קצת, צריך לראות גם את הריצה וגם את ההמשך אחרי הכדור'), 'back');
    } else if (needMoreFront) {
      const m = camMove(dir);
      fail('room', m.text + ', שיהיה מקום אחרי הכדור', m.arrow);
    } else if (needMoreBack || u(s.ball.x) < F.ballMinLead) {
      const m = camMove(-dir);
      fail('room', m.text + ', שתיראה ריצת התנופה', m.arrow);
    } else pass('room');

    // צילום מהצד: כתפיים "צרות" בתמונה, והילד והכדור באותו עומק (באותו גובה בתמונה)
    const lsh = s.pose[LM.L_SH], rsh = s.pose[LM.R_SH];
    const shMid = mid(lsh, rsh);
    const hipMid = mid(s.pose[LM.L_HIP], s.pose[LM.R_HIP]);
    const torso = Math.hypot((shMid.x - hipMid.x) * s.aspect, shMid.y - hipMid.y);
    const shoulderRatio = torso > 0 ? (Math.abs(lsh.x - rsh.x) * s.aspect) / torso : 0;
    const feetY = Math.max(s.pose[LM.L_HEEL].y, s.pose[LM.R_HEEL].y, s.pose[LM.L_FOOT].y, s.pose[LM.R_FOOT].y);
    const ballBottom = s.ball.y + s.ball.h / 2;
    const depthDiff = Math.abs(feetY - ballBottom);
    if (shoulderRatio > F.maxShoulderRatio || depthDiff > F.maxDepthDiff) {
      fail('side', g('עמוד בצד, בניצב לכיוון הבעיטה, כך שהילד והכדור באותו מרחק ממך', 'עמדי בצד, בניצב לכיוון הבעיטה, כך שהילד והכדור באותו מרחק ממך'), 'side');
    } else pass('side');
  }

  // 7. טלפון ישר ויציב
  const sen = s.sensors || {};
  if (sen.roll != null && Math.abs(sen.roll) > F.maxRollDeg) {
    fail('steady', g('החזק את הטלפון ישר', 'החזיקי את הטלפון ישר'), 'level');
  } else if (sen.shake > F.maxShake) {
    fail('steady', g('החזק את הטלפון יציב', 'החזיקי את הטלפון יציב'), null);
  } else pass('steady');

  // 8. תאורה
  if (s.brightness != null && s.brightness < F.minBrightness) fail('light', 'חשוך מדי. כדאי לצלם במקום מואר יותר', null);
  else pass('light');

  const order = Object.keys(CHECK_LABELS);
  const list = order.map((id) => ({ id, label: CHECK_LABELS[id], ok: checks[id] ? checks[id].ok : false }));
  const first = order.find((id) => checks[id] && !checks[id].ok);
  const instruction = first
    ? { id: first + ':' + checks[first].text, text: checks[first].text, arrow: checks[first].arrow }
    : { id: 'ready', text: 'מצוין! לא לזוז', arrow: null };
  return { checks: list, ready: !first, instruction };
}
