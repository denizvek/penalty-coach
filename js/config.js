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
  snapshotWidth: 360, // רוחב תמונות הפריימים שנשמרות לצפייה חוזרת

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

  // ספים לניתוח הבעיטה. יחידות אורך = אורך רגל של הילד (L)
  analysis: {
    runupMinL: 2.5,
    runupMaxL: 11,
    backswingGoodDeg: 115, // זווית ברך מינימלית של רגל הבעיטה בהנפה (קטן = כיפוף גדול)
    plantMinL: -0.45, // מיקום רגל התמיכה ביחס למרכז הכדור (שלילי = מאחורי הכדור)
    plantMaxL: 0.2,
    plantKneeMin: 125,
    plantKneeMax: 173,
    leanMinDeg: -8, // הטיית גו (חיובי = קדימה לכיוון הבעיטה)
    leanMaxDeg: 30,
    followGoodL: 0.75,
    maxContactDistL: 1.1,
  },
};
