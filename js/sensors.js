// חיישני הטלפון: האם הטלפון ישר (roll) והאם הוא רועד (shake).

// landscape: האם הטלפון מוחזק פיזית לרוחב (לפי כוח הכובד). null = לא ידוע
export const sensors = { roll: null, shake: 0, available: false, landscape: null };
let started = false;

function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (g && g.x != null && g.y != null) {
    // כשהטלפון שוכב על הגב אין משמעות ל"ישר"
    if (Math.hypot(g.x, g.y) > 4) {
      const theta = (Math.atan2(g.x, g.y) * 180) / Math.PI;
      // סטייה מהציר הקרוב ביותר – עובד בכל כיוון מסך ובשני סוגי הסימנים (אנדרואיד/אייפון)
      let d = ((theta % 90) + 90) % 90;
      if (d > 45) d -= 90;
      sensors.roll = d;
      const ax = Math.abs(g.x), ay = Math.abs(g.y);
      if (ax > ay * 1.3) sensors.landscape = true;
      else if (ay > ax * 1.3) sensors.landscape = false;
    } else sensors.roll = null;
    sensors.available = true;
  }
  const rr = e.rotationRate;
  if (rr) {
    const m = Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0);
    sensors.shake = sensors.shake * 0.85 + m * 0.15;
  }
}

// באייפון חייבים לקרוא לזה מתוך לחיצה של המשתמש
export async function startSensors() {
  if (started) return true;
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') return false;
    }
    window.addEventListener('devicemotion', onMotion);
    started = true;
    return true;
  } catch (e) {
    console.warn('אין גישה לחיישנים', e);
    return false;
  }
}
