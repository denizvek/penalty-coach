// הגדרות מרכזיות. כל הספים לניתוח ולכיוון המצלמה נמצאים כאן כדי שיהיה קל לכוונן אותם בשטח.

const MP_VERSION = '0.10.14';

export const CONFIG = {
  mpBundle: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`,
  mpWasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`,
  poseLiteModel:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  poseFullModel:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  ballModel:
    'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',

  // הקלטה
  readyHoldMs: 1000, // כמה זמן הפריים צריך להיות "ירוק" לפני שמתחילים להקליט
  maxBufferMs: 8000, // כמה שניות אחרונות שומרים בזמן המתנה לבעיטה
  armedTimeoutMs: 40000, // אם אין בעיטה – חוזרים לכיוון
  afterKickMs: 1000, // ממשיכים להקליט אחרי הבעיטה (בשביל ההמשך של התנועה)
  ballEveryNFrames: 3, // זיהוי כדור בכל N פריימים (חוסך חישוב)
  snapshotWidth: 320, // רוחב תמונות הפריימים בזמן אמת
  denseSnapshotWidth: 560, // רוחב התמונות בניתוח המדויק סביב הבעיטה (גם בשביל המאמן החכם)

  // המאמן החכם (Claude): כתובת פונקציית השרת. ריק = כבוי
  aiEndpoint: 'https://feoomirbcgyypvueaonc.supabase.co/functions/v1/kick-review',
  aiImageMax: 640, // צלע מקסימלית של תמונה שנשלחת
  aiTimeoutMs: 35000,

  framing: {
    minKidHeight: 0.28, // גובה הילד כחלק מגובה הפריים
    maxKidHeight: 0.6,
    edgeMargin: 0.03,
    ballMaxLead: 0.84, // מיקום מקסימלי של הכדור בכיוון הבעיטה (משאיר מקום להמשך תנועה)
    ballMinLead: 0.45,
    maxShoulderRatio: 0.6, // רוחב כתפיים / אורך גו – מעל זה הצילום כנראה מלפנים
    maxDepthDiff: 0.12, // הפרש גובה בין כפות הרגליים לתחתית הכדור
    maxRollDeg: 8,
    maxShake: 45,
    minBrightness: 45,
  },

  // ספים לניתוח הבעיטה. יחידות אורך = אורך רגל של הילד (L).
  // לכל מדד: טווח "טוב" (משבחים), טווח "בסדר" (לא מעירים), ומחוץ לו – הערה לשיפור.
  // הטווחים רחבים בכוונה: צילום דו-ממדי רועש, ועדיף לפספס הערה מאשר להעיר הערה לא נכונה.
  analysis: {
    minVis: 0.5, // מתחת לרמת ביטחון זו בנקודות הגוף – לא מודדים
    runup: { good: [3, 10], ok: [2, 13] },
    backswing: { good: 110, ok: 135 }, // זווית ברך מינימלית (קטן = כיפוף גדול)
    plant: { good: [-0.45, 0.2], ok: [-0.65, 0.35] }, // שלילי = מאחורי הכדור
    plantKnee: { good: [120, 172], ok: [108, 177] },
    lean: { good: [-8, 30], ok: [-16, 40] }, // מעלות, חיובי = קדימה
    follow: { good: 0.75, ok: 0.45 },
    maxContactDistL: 1.1,
  },
};
