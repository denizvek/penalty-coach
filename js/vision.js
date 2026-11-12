// טעינת המודלים של MediaPipe והרצת זיהוי שלד + כדור על פריים.

import { CONFIG } from './config.js';
import { LM, mid, bodyBox } from './geom.js';

let mp = null;
let fileset = null;
const tasks = {};
let lastTs = 0;

// MediaPipe דורש חותמות זמן עולות בכל קריאה
function nextTs(t) {
  const ts = Math.max(Math.round(t), lastTs + 1);
  lastTs = ts;
  return ts;
}

async function create(Cls, options) {
  try {
    return await Cls.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } });
  } catch (e) {
    console.warn('GPU לא זמין, עוברים ל-CPU', e);
    return await Cls.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
  }
}

export async function loadModels({ full = false, onStatus = () => {} } = {}) {
  if (!mp) {
    onStatus('טוען את מנוע הזיהוי…');
    mp = await import(CONFIG.mpBundle);
    fileset = await mp.FilesetResolver.forVisionTasks(CONFIG.mpWasm);
  }
  const key = full ? 'poseFull' : 'pose';
  if (!tasks[key]) {
    onStatus('טוען מודל תנועה…');
    tasks[key] = await create(mp.PoseLandmarker, {
      baseOptions: { modelAssetPath: full ? CONFIG.poseFullModel : CONFIG.poseLiteModel },
      runningMode: 'VIDEO',
      numPoses: 3,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }
  if (!tasks.ball) {
    onStatus('טוען מודל זיהוי כדור…');
    tasks.ball = await create(mp.ObjectDetector, {
      baseOptions: { modelAssetPath: CONFIG.ballModel },
      runningMode: 'VIDEO',
      scoreThreshold: 0.2,
      maxResults: 5,
      categoryAllowlist: ['sports ball'],
    });
  }
}

// כל הדמויות שזוהו בפריים
export function detectPoses(source, t, full = false) {
  const task = tasks[full ? 'poseFull' : 'pose'];
  const res = task.detectForVideo(source, nextTs(t));
  return (res.landmarks || []).map((lm) => lm.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 })));
}

// כל המועמדים לכדור, מנורמלים
export function detectBalls(source, t, w, h) {
  const res = tasks.ball.detectForVideo(source, nextTs(t));
  return (res.detections || []).map((d) => ({
    x: (d.boundingBox.originX + d.boundingBox.width / 2) / w,
    y: (d.boundingBox.originY + d.boundingBox.height / 2) / h,
    w: d.boundingBox.width / w,
    h: d.boundingBox.height / h,
    score: d.categories?.[0]?.score ?? 0,
  }));
}

// בחירת הבועט מבין כמה ילדים: ממשיכים עם מי שבחרנו קודם, אחרת הקרוב לכדור, אחרת הגדול
export function selectKid(poses, ball, prevHip) {
  if (!poses.length) return null;
  if (poses.length === 1) return poses[0];
  const hip = (lm) => mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  if (prevHip) {
    return poses.reduce((a, b) => (Math.hypot(hip(a).x - prevHip.x, hip(a).y - prevHip.y) <= Math.hypot(hip(b).x - prevHip.x, hip(b).y - prevHip.y) ? a : b));
  }
  if (ball) return poses.reduce((a, b) => (Math.abs(hip(a).x - ball.x) <= Math.abs(hip(b).x - ball.x) ? a : b));
  return poses.reduce((a, b) => ((bodyBox(a)?.h ?? 0) >= (bodyBox(b)?.h ?? 0) ? a : b));
}

// בחירת הכדור: קרוב לכדור הקודם, ובגודל סביר ביחס לילד
export function selectBall(cands, prevBall, kidHeight) {
  let list = cands;
  if (kidHeight) list = list.filter((c) => c.h / kidHeight > 0.04 && c.h / kidHeight < 0.4);
  if (!list.length) return null;
  if (prevBall) {
    const near = list.reduce((a, b) => (Math.hypot(a.x - prevBall.x, a.y - prevBall.y) <= Math.hypot(b.x - prevBall.x, b.y - prevBall.y) ? a : b));
    return near;
  }
  return list.reduce((a, b) => (a.score >= b.score ? a : b));
}
