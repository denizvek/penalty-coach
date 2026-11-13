// הבקר הראשי: מסכים, מצלמה, עוזר כיוון, הקלטה אוטומטית, ניתוח ומשוב.

import { CONFIG } from './config.js';
import { loadModels, detectPoses, detectBalls, selectKid, selectBall } from './vision.js';
import { evaluateFraming } from './framing.js';
import { analyzeKick, kickHappened } from './analyze.js';
import { buildFeedback, errorMessage, METRIC_NAMES } from './feedback.js';
import { drawSkeleton, drawBall, drawContactMarks, containRect } from './draw.js';
import { sensors, startSensors } from './sensors.js';
import { speak, stopSpeech, unlockSpeech, setSpeechEnabled, hasHebrewVoice, speechSupported } from './speech.js';
import { reviewKick, aiConfigured, aiSpeech } from './ai.js';
import { getSettings, saveSettings, getHistory, addHistory, clearHistory } from './store.js';
import { bodyBox, hipCenter, legLength, median } from './geom.js';

const $ = (s) => document.querySelector(s);
const video = $('#video');
const overlay = $('#overlay');
const octx = overlay.getContext('2d');

let settings = getSettings();
const g = (m, f) => (settings.gender === 'f' ? f : m);

const S = {
  screen: 'home',
  stream: null,
  phase: 'framing', // framing | recording | analyzing
  frames: [],
  aspect: 16 / 9,
  ballManual: null,
  ballTrack: null,
  ballMiss: 0,
  prevHip: null,
  rot: 0, // סיבוב הפריים לזיהוי: 0, 90 או -90
  rotBad: 0,
  readySince: 0,
  armedAt: 0,
  armRef: null,
  armDir: 1,
  armL: NaN,
  kickAt: 0,
  frameNo: 0,
  brightness: null,
  lastFraming: null,
  speech: { pendingId: '', pendingSince: 0, lastId: '', lastAt: 0 },
  wakeLock: null,
  cancelProcessing: false,
  // תוצאות
  res: null,
};

// ---------- מסכים ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  S.screen = id;
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- מסך בית ----------
function renderHome() {
  $('#greeting').textContent = settings.name
    ? `${g('מוכן', 'מוכנה')} לבעוט, ${settings.name}?`
    : 'מצלמים בעיטה ומקבלים משוב על התנועה';
  const h = getHistory();
  $('#history-card').hidden = !h.length;
  $('#history-list').innerHTML = h
    .slice(0, 6)
    .map((x) => {
      const d = new Date(x.date);
      const date = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      return `<li><span class="date">${date}</span><span>${'★'.repeat(x.good)}${'☆'.repeat(Math.max(0, x.total - x.good))} &nbsp;${x.good}/${x.total}</span></li>`;
    })
    .join('');
}

// ---------- הגדרות ----------
function openSettings() {
  $('#set-name').value = settings.name;
  document.querySelectorAll('input[name=gender]').forEach((r) => (r.checked = r.value === settings.gender));
  $('#set-voice').checked = settings.voice;
  $('#set-front').checked = settings.facing === 'user';
  $('#set-debug').checked = settings.debug;
  $('#set-ai').checked = settings.ai;
  $('#set-age').value = settings.age || '';
  $('#voice-note').textContent = !speechSupported()
    ? 'הדפדפן הזה לא תומך בהקראה.'
    : hasHebrewVoice()
      ? ''
      : 'לא נמצא קול עברי בטלפון. אפשר להתקין "עברית" בהגדרות ההקראה (Text-to-speech) של הטלפון.';
  $('#settings').showModal();
}
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'ok') return;
  settings = {
    ...settings,
    name: $('#set-name').value.trim(),
    gender: document.querySelector('input[name=gender]:checked')?.value || 'm',
    voice: $('#set-voice').checked,
    facing: $('#set-front').checked ? 'user' : 'environment',
    debug: $('#set-debug').checked,
    ai: $('#set-ai').checked,
    age: $('#set-age').value.replace(/\D/g, '').slice(0, 2),
  };
  saveSettings(settings);
  setSpeechEnabled(settings.voice);
  renderHome();
});
$('#btn-clear-history').addEventListener('click', () => {
  if (confirm('למחוק את כל ההיסטוריה?')) {
    clearHistory();
    renderHome();
  }
});

// ---------- מצלמה ----------
// מבקשים מהמצלמה את קצב הפריימים הגבוה ביותר שהיא תומכת בו (עד 120)
async function boostFrameRate(stream) {
  const track = stream.getVideoTracks()[0];
  try {
    const max = track.getCapabilities?.().frameRate?.max;
    if (max && max > 30) await track.applyConstraints({ frameRate: { ideal: Math.min(120, max) } });
  } catch (e) { console.warn('frameRate', e); }
  S.camFps = Math.round(track.getSettings?.().frameRate || 0) || null;
}

async function openCamera() {
  unlockSpeech();
  await startSensors();
  show('camera');
  setBanner('טוען את המודלים… (בפעם הראשונה זה לוקח כמה שניות)', null);
  resetLive();
  try {
    const [stream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: settings.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      }),
      loadModels({ onStatus: (t) => setBanner(t, null) }),
    ]);
    S.stream = stream;
    await boostFrameRate(stream);
    video.srcObject = stream;
    video.style.transform = settings.facing === 'user' ? 'scaleX(-1)' : '';
    overlay.style.transform = video.style.transform;
    await video.play();
    requestWakeLock();
    scheduleFrame();
    // טוענים ברקע את המודל המדויק, כדי שהניתוח אחרי הבעיטה יתחיל מיד
    setTimeout(() => loadModels({ full: true }).catch(() => {}), 1500);
  } catch (e) {
    console.error(e);
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    setBanner(denied ? 'אין הרשאה למצלמה. יש לאשר גישה למצלמה בהגדרות הדפדפן.' : 'לא הצלחתי להפעיל את המצלמה או לטעון את המודלים. בדקו חיבור לאינטרנט ונסו שוב.', null);
  }
}

function closeCamera() {
  stopSpeech();
  if (S.rec) { try { S.rec.rec.stop(); } catch { /* */ } S.rec = null; }
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  S.stream = null;
  video.srcObject = null;
  releaseWakeLock();
}

function resetLive() {
  S.phase = 'framing';
  S.frames = [];
  S.ballTrack = null;
  S.ballMiss = 0;
  S.prevHip = null;
  S.readySince = 0;
  S.kickAt = 0;
  S.armRef = null;
  S.frameNo = 0;
  S.rotBad = 0;
  S.speech = { pendingId: '', pendingSince: 0, lastId: '', lastAt: 0 };
  $('#btn-stop').hidden = true;
  $('#btn-record-now').hidden = false;
  $('#phase-pill').textContent = 'כיוון';
  $('#phase-pill').classList.remove('rec');
  $('#banner').classList.remove('rec', 'ready');
  updateBallButtons();
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) S.wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* לא נתמך */ }
}
function releaseWakeLock() {
  try { S.wakeLock?.release(); } catch { /* */ }
  S.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.screen === 'camera' && S.stream) requestWakeLock();
});

let lastVideoTime = -1;
function scheduleFrame() {
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onFrame);
}
function onFrame() {
  if (S.screen !== 'camera' || !S.stream) return;
  try {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      processLive(performance.now());
    }
  } catch (e) {
    console.error(e);
  }
  if (S.phase !== 'analyzing') scheduleFrame();
}

// תמונות קטנות של הפריימים לצפייה חוזרת. משתמשים מחדש בקנבסים כדי לחסוך זיכרון.
const snapPool = [];
function snapshot(src, w, h, sw = CONFIG.snapshotWidth) {
  const sh = Math.round((sw * h) / w);
  const c = snapPool.pop() || document.createElement('canvas');
  if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
  c.getContext('2d').drawImage(src, 0, 0, sw, sh);
  return c;
}
function recycle(frames) {
  for (const f of frames) if (f.snap && f.snap.width === CONFIG.snapshotWidth && snapPool.length < 60) snapPool.push(f.snap);
}

const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 32; lumaCanvas.height = 18;
function measureBrightness() {
  const c = lumaCanvas.getContext('2d', { willReadFrequently: true });
  c.drawImage(video, 0, 0, 32, 18);
  const d = c.getImageData(0, 0, 32, 18).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}

function trackBall(cands, kidH) {
  if (!cands) return S.ballTrack;
  const b = selectBall(cands, S.ballTrack, kidH);
  if (b) {
    S.ballMiss = 0;
    // החלקה קלה כשהכדור עומד, כדי שהמסגרת לא תרצד
    if (S.ballTrack && Math.hypot(b.x - S.ballTrack.x, b.y - S.ballTrack.y) < 0.02) {
      S.ballTrack = { x: S.ballTrack.x * 0.6 + b.x * 0.4, y: S.ballTrack.y * 0.6 + b.y * 0.4, w: b.w, h: b.h };
    } else S.ballTrack = b;
    return b;
  }
  if (++S.ballMiss > 12) S.ballTrack = null;
  return null;
}

// ---------- סיבוב ----------
// כשנעילת הסיבוב של הטלפון דולקת, המצלמה ממשיכה לשלוח פריים "לאורך" גם כשמחזיקים את הטלפון לרוחב.
// במקרה כזה מסובבים את הפריים בעצמנו לפני הזיהוי, ומסובבים גם את הכיתובים על המסך.
const rotCanvas = document.createElement('canvas');

function rotCandidates(rawPortrait) {
  if (!rawPortrait) return [0];
  if (sensors.landscape === true) return [90, -90];
  if (sensors.landscape === false) return [0];
  return [0, 90, -90]; // אין חיישנים – מנסים לפי מה שהזיהוי מוצא
}

// האם הילד "עומד" בפריים (כתפיים מעל האגן)
function upright(lm, aspect) {
  const sh = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
  const hp = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
  const dy = hp.y - sh.y, dx = (hp.x - sh.x) * aspect;
  return dy > 0 && dy > Math.abs(dx) * 0.7;
}

function updateRotation(rawPortrait, kid, aspect) {
  const cands = rotCandidates(rawPortrait);
  if (!cands.includes(S.rot)) { S.rot = cands[0]; S.rotBad = 0; return; }
  if (S.phase !== 'framing' || cands.length === 1) return;
  if (kid && upright(kid, aspect)) { S.rotBad = 0; return; }
  // הילד הפוך/שוכב או לא נמצא – אחרי כמה פריימים מנסים את הסיבוב הבא
  S.rotBad += kid ? 3 : 1;
  if (S.rotBad >= 12) {
    S.rot = cands[(cands.indexOf(S.rot) + 1) % cands.length];
    S.rotBad = 0;
  }
}

function rotatedSource(rot, rw, rh, src = video) {
  if (!rot) return src;
  if (rotCanvas.width !== rh || rotCanvas.height !== rw) { rotCanvas.width = rh; rotCanvas.height = rw; }
  const c = rotCanvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (rot === 90) { c.translate(rh, 0); c.rotate(Math.PI / 2); }
  else { c.translate(0, rw); c.rotate(-Math.PI / 2); }
  c.drawImage(src, 0, 0, rw, rh);
  return rotCanvas;
}

// מקואורדינטות הפריים המסובב לקואורדינטות הווידאו המקורי (בשביל הציור על המסך) ובחזרה
function toRaw(p, rot) {
  if (!rot) return p;
  return rot === 90 ? { ...p, x: p.y, y: 1 - p.x } : { ...p, x: 1 - p.y, y: p.x };
}
function fromRaw(p, rot) {
  if (!rot) return p;
  return rot === 90 ? { x: 1 - p.y, y: p.x } : { x: p.y, y: 1 - p.x };
}
function ballToRaw(b, rot) {
  if (!b || !rot) return b;
  return { ...toRaw(b, rot), w: b.h, h: b.w };
}

function applyUiRotation() {
  // מסובבים את הכיתובים רק כשהמסך עצמו נשאר לאורך
  const r = S.rot && window.innerHeight > window.innerWidth ? S.rot : 0;
  const ui = $('#cam-ui');
  if (ui.dataset.rot !== String(r)) {
    ui.dataset.rot = String(r);
    ui.classList.toggle('rotated', !!r);
    ui.style.setProperty('--rot', `${r}deg`);
  }
}

function processLive(t) {
  const rw = video.videoWidth, rh = video.videoHeight;
  if (!rw || !rh) return;
  S.frameNo++;
  const rawPortrait = rw < rh;
  if (!rotCandidates(rawPortrait).includes(S.rot)) updateRotation(rawPortrait, null, rw / rh);
  const src = rotatedSource(S.rot, rw, rh);
  const vw = S.rot ? rh : rw, vh = S.rot ? rw : rh;
  S.aspect = vw / vh;
  applyUiRotation();

  const poses = detectPoses(src, t);
  const every = S.phase === 'recording' ? 2 : CONFIG.ballEveryNFrames;
  const cands = S.frameNo % every === 0 ? detectBalls(src, t, vw, vh) : null;
  const refBall = S.ballManual || S.ballTrack;
  const kid = selectKid(poses, refBall, S.phase === 'recording' ? S.prevHip : null);
  S.prevHip = kid ? hipCenter(kid) : S.prevHip;
  const kidBox = kid ? bodyBox(kid) : null;
  const seenBall = trackBall(cands, kidBox?.h);
  const rotBefore = S.rot;
  updateRotation(rawPortrait, kid, S.aspect);
  if (S.rot !== rotBefore) { S.ballTrack = null; S.ballManual = null; S.prevHip = null; updateBallButtons(); }
  if (S.frameNo % 15 === 1) S.brightness = measureBrightness();

  const frame = { t, pose: kid, ball: seenBall, snap: snapshot(src, vw, vh) };

  if (S.phase === 'framing') {
    // שומרים שנייה וחצי אחרונה, למקרה שהילד מתחיל לרוץ מיד
    S.frames.push(frame);
    while (S.frames.length && S.frames[0].t < t - 1500) recycle(S.frames.splice(0, 1));

    const ev = evaluateFraming({
      pose: kid,
      ball: S.ballManual || S.ballTrack,
      aspect: S.aspect,
      mirrored: settings.facing === 'user',
      sensors,
      brightness: S.brightness,
      gender: settings.gender,
    });
    S.lastFraming = ev;
    renderFraming(ev);
    if (ev.ready) {
      if (!S.readySince) S.readySince = t;
      if (t - S.readySince > CONFIG.readyHoldMs) arm(t, kid);
    } else S.readySince = 0;
    speakInstruction(ev.instruction, t);
  } else if (S.phase === 'recording') {
    S.frames.push(frame);
    if (!S.kickAt) {
      while (S.frames.length && S.frames[0].t < t - CONFIG.maxBufferMs) recycle(S.frames.splice(0, 1));
      if (S.armRef && kickHappened(frame, S.aspect, S.armRef, S.armL, S.armDir)) {
        S.kickAt = t;
        setBanner('בעיטה! עוד רגע…', null);
      } else if (t - S.armedAt > CONFIG.armedTimeoutMs) {
        speak('לא זיהיתי בעיטה. נכוון שוב');
        stopRecorder();
        recycle(S.frames);
        resetLive();
      }
    } else if (t - S.kickAt > CONFIG.afterKickMs) {
      finishRecording();
    }
  }
  drawLive(kid, frame.ball);
}

// ---------- הקלטת וידאו מלאה (בקצב המלא של המצלמה) ----------
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* */ }
  }
  return '';
}
function startRecorder() {
  S.rec = null;
  const mime = pickMime();
  if (mime === null || !S.stream) return;
  try {
    const rec = new MediaRecorder(S.stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 8_000_000 });
    const r = { rec, chunks: [], startedAt: performance.now(), mime: rec.mimeType || mime };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    rec.onstart = () => { r.startedAt = performance.now(); };
    rec.start();
    S.rec = r;
  } catch (e) {
    console.warn('אין הקלטת וידאו בדפדפן הזה', e);
  }
}
function stopRecorder() {
  const r = S.rec;
  S.rec = null;
  if (!r || r.rec.state === 'inactive') return Promise.resolve(null);
  return new Promise((resolve) => {
    r.rec.onstop = () => resolve({ blob: new Blob(r.chunks, { type: r.mime || 'video/webm' }), startedAt: r.startedAt });
    try { r.rec.stop(); } catch { resolve(null); }
  });
}

function arm(t, kid) {
  const ball = S.ballManual || S.ballTrack;
  S.phase = 'recording';
  S.armedAt = t;
  S.kickAt = 0;
  S.armRef = ball ? { ...ball } : null;
  S.armDir = kid && ball ? Math.sign(ball.x - hipCenter(kid).x) || 1 : 1;
  const legs = S.frames.map((f) => (f.pose ? legLength(f.pose, S.aspect) : NaN));
  S.armL = median(legs);
  $('#btn-record-now').hidden = true;
  $('#btn-stop').hidden = false;
  $('#phase-pill').textContent = 'מקליט';
  $('#phase-pill').classList.add('rec');
  $('#banner').classList.remove('ready');
  $('#banner').classList.add('rec');
  setBanner(S.armRef ? 'מוכן! אפשר לבעוט' : 'מקליט. אחרי הבעיטה לחצו "עצור ונתח"', null);
  speak('מוכן! אפשר לבעוט');
  startRecorder();
  renderChips(null);
  $('#tap-hint').hidden = true;
}

async function finishRecording() {
  S.phase = 'analyzing';
  const liveFrames = S.frames;
  S.frames = [];
  const aspect = S.aspect;
  const ballRef = S.armRef;
  const rot = S.rot;
  const kickAt = S.kickAt || performance.now();
  const recorded = await stopRecorder();
  closeCamera();

  // ניתוח מדויק: כל פריים מהסרטון שהוקלט, סביב רגע הבעיטה (4 שניות לפני, 1.3 אחרי)
  if (recorded && recorded.blob.size > 0) {
    show('processing');
    S.cancelProcessing = false;
    const prog = procProgress('מנתח את הבעיטה…');
    prog(0, 'מנתח את הבעיטה…');
    const vid = await openVideo(recorded.blob);
    try {
      await Promise.all([vid.loaded, loadModels({ full: true, onStatus: (t) => prog(0, t) })]);
      // רגע המגע המשוער: מהניתוח החי אם הצליח, אחרת מרגע זיהוי הבעיטה
      const live = analyzeKick(liveFrames, aspect, ballRef);
      const cPerf = live.ok ? liveFrames[live.contactIdx].t : kickAt - 120;
      const cV = (cPerf - recorded.startedAt) / 1000;
      // לפני הבעיטה: פריים כל ~70ms (ריצה). סביב הבעיטה: כל פריים. אחרי: כל ~40ms
      const start = Math.max(0, cV - 2.2), end = cV + 0.7;
      const stride = (mt) => (mt < cV - 0.45 ? 0.07 : mt > cV + 0.25 ? 0.04 : 0);
      const st = { ballTrack: ballRef, prevHip: null, miss: 0, aspect };
      const frames = await densePass(vid.v, {
        start, end, rot, maxFrames: 130, st, stride,
        onProgress: (p) => prog(p, `מנתח את הבעיטה… ${Math.round(p * 100)}%`),
      });
      const a2 = st.aspect;
      if (frames.filter((f) => f.pose).length >= 8) {
        const result = analyzeKick(frames, a2, ballRef);
        if (result.ok || !analyzeKick(liveFrames, aspect, ballRef).ok) {
          recycle(liveFrames);
          showResults(frames, a2, result, { manualBall: ballRef });
          return;
        }
      }
    } catch (e) {
      if (e.message === 'cancel') { recycle(liveFrames); show('home'); renderHome(); return; }
      console.warn('ניתוח הסרטון נכשל, משתמשים בניתוח החי', e);
    } finally {
      vid.close();
    }
  }
  // גיבוי: הפריימים שנותחו בזמן אמת
  const result = analyzeKick(liveFrames, aspect, ballRef);
  showResults(liveFrames, aspect, result, { manualBall: ballRef });
}

function speakInstruction(instr, t) {
  const sp = S.speech;
  if (instr.id !== sp.pendingId) {
    sp.pendingId = instr.id;
    sp.pendingSince = t;
    return;
  }
  if (t - sp.pendingSince < 700) return; // ההוראה צריכה להיות יציבה לפני שמקריאים אותה
  if (instr.id === 'ready') return; // "מוכן" נאמר כשההקלטה מתחילה
  const since = t - sp.lastAt;
  if ((instr.id === sp.lastId && since > 6000) || (instr.id !== sp.lastId && since > 2200)) {
    speak(instr.text);
    sp.lastId = instr.id;
    sp.lastAt = t;
  }
}

const ARROWS = { left: '⬅️', right: '➡️', up: '⬆️', down: '⬇️', back: '🔙', forward: '🔜', rotate: '🔄', side: '↪️', level: '📐' };
function setBanner(text, arrow) {
  $('#instruction').textContent = text;
  $('#arrow').textContent = arrow ? ARROWS[arrow] || '' : '';
}

function renderFraming(ev) {
  setBanner(ev.instruction.text, ev.instruction.arrow);
  $('#banner').classList.toggle('ready', ev.ready);
  renderChips(ev.checks);
  $('#tap-hint').hidden = !!(S.ballTrack || S.ballManual) || S.phase !== 'framing';
}

let lastChipsKey = '';
function renderChips(checks) {
  const key = checks ? checks.map((c) => c.ok).join() : '';
  if (key === lastChipsKey) return;
  lastChipsKey = key;
  $('#chips').innerHTML = checks ? checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${c.label}</li>`).join('') : '';
}

function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w, h, dpr };
}

function drawLive(kid, seenBall) {
  const { w, h } = fitCanvas(overlay);
  octx.clearRect(0, 0, w, h);
  const rect = containRect(video.videoWidth, video.videoHeight, w, h);
  const ready = S.phase === 'recording' || S.lastFraming?.ready;
  // מסגרת צבעונית סביב התמונה
  octx.strokeStyle = S.phase === 'recording' ? '#ef5350' : ready ? '#66bb6a' : 'rgba(255,202,40,.8)';
  octx.lineWidth = 6;
  octx.strokeRect(rect.x + 3, rect.y + 3, rect.w - 6, rect.h - 6);
  drawSkeleton(octx, kid && S.rot ? kid.map((p) => toRaw(p, S.rot)) : kid, rect);
  const ball = S.ballManual || S.ballTrack;
  drawBall(octx, ballToRaw(ball, S.rot), rect, { manual: !!S.ballManual, label: S.ballManual && settings.facing !== 'user' ? 'כדור (סומן)' : '' });
  if (settings.debug) {
    const dbg = $('#debug');
    dbg.hidden = false;
    const box = kid ? bodyBox(kid) : null;
    dbg.textContent = [
      `phase ${S.phase}  frame ${S.frameNo}`,
      `video ${video.videoWidth}x${video.videoHeight}  rot ${S.rot}  phone ${sensors.landscape == null ? '?' : sensors.landscape ? 'landscape' : 'portrait'}`,
      `kid h ${box ? box.h.toFixed(2) : '-'}  ball ${ball ? `${ball.x.toFixed(2)},${ball.y.toFixed(2)} h${ball.h.toFixed(3)}` : '-'} seen ${seenBall ? 'y' : 'n'}`,
      `roll ${sensors.roll == null ? '-' : sensors.roll.toFixed(1)}  shake ${sensors.shake.toFixed(0)}  light ${S.brightness?.toFixed(0)}`,
      `buffer ${S.frames.length}  L ${Number.isFinite(S.armL) ? S.armL.toFixed(3) : '-'}  camera ${S.camFps || '?'}fps  rec ${S.rec ? 'on' : 'off'}`,
    ].join('\n');
  } else $('#debug').hidden = true;
}

// הקשה על המסך = סימון הכדור ידנית
function tapToBall(ev, canvas, vw, vh) {
  const r = canvas.getBoundingClientRect();
  const rect = containRect(vw, vh, r.width, r.height);
  let x = (ev.clientX - r.left - rect.x) / rect.w;
  const y = (ev.clientY - r.top - rect.y) / rect.h;
  if (canvas === overlay && settings.facing === 'user') x = 1 - x;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}
overlay.addEventListener('click', (ev) => {
  if (S.phase !== 'framing' || !video.videoWidth) return;
  const raw = tapToBall(ev, overlay, video.videoWidth, video.videoHeight);
  if (!raw) return;
  const p = fromRaw(raw, S.rot);
  const kidH = S.frames.length && S.frames[S.frames.length - 1].pose ? bodyBox(S.frames[S.frames.length - 1].pose)?.h : null;
  const h = kidH ? kidH * 0.13 : 0.05;
  S.ballManual = { x: p.x, y: p.y, w: h / S.aspect, h };
  S.readySince = 0;
  updateBallButtons();
  toast('הכדור סומן');
});
function updateBallButtons() {
  $('#btn-clear-ball').hidden = !S.ballManual;
}
$('#btn-clear-ball').addEventListener('click', () => {
  S.ballManual = null;
  updateBallButtons();
});
$('#btn-record-now').addEventListener('click', () => {
  const last = S.frames[S.frames.length - 1];
  arm(performance.now(), last?.pose || null);
});
$('#btn-stop').addEventListener('click', () => {
  if (S.phase === 'recording') finishRecording();
});
$('#btn-close').addEventListener('click', () => {
  closeCamera();
  recycle(S.frames);
  S.frames = [];
  show('home');
  renderHome();
});

// ---------- ניתוח סרטון מהגלריה ----------
const once = (el, ev) => new Promise((res, rej) => {
  const ok = () => { el.removeEventListener('error', bad); res(); };
  const bad = () => { el.removeEventListener(ev, ok); rej(new Error('video error')); };
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', bad, { once: true });
});

const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
async function seek(v, t) {
  const done = once(v, 'seeked').catch(() => {});
  v.currentTime = t;
  await Promise.race([done, timeout(1500)]);
  if (v.requestVideoFrameCallback) {
    await Promise.race([new Promise((r) => v.requestVideoFrameCallback(() => r())), new Promise((r) => setTimeout(r, 120))]);
  }
}

// ---------- ניתוח וידאו פריים-אחרי-פריים ----------
// משמש גם לסרטון שהוקלט באפליקציה וגם לסרטון מהגלריה. כאן אין לחץ זמן אמת, אז מנתחים כל פריים
// עם המודל המדויק (full). כך מקבלים את כל הפריימים שהמצלמה צילמה, ולא רק את אלה שהספקנו בזמן אמת.

function makeHiddenVideo() {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0.01;pointer-events:none;bottom:0;left:0';
  document.body.appendChild(v);
  return v;
}

function processStill(v, t, rot, st, { full = true, snapW = CONFIG.denseSnapshotWidth } = {}) {
  const rw = v.videoWidth, rh = v.videoHeight;
  const src = rotatedSource(rot, rw, rh, v);
  const vw = rot ? rh : rw, vh = rot ? rw : rh;
  const poses = detectPoses(src, t, full);
  // זיהוי כדור רק בכל פריים שני (הוא איטי, והכדור עומד עד הבעיטה)
  st.n = (st.n || 0) + 1;
  const cands = st.n % 2 === 1 || !st.ballTrack ? detectBalls(src, t, vw, vh) : null;
  const kid = selectKid(poses, st.ballTrack, st.prevHip);
  if (kid) st.prevHip = hipCenter(kid);
  const b = cands ? selectBall(cands, st.ballTrack, kid ? bodyBox(kid)?.h : null) : null;
  if (b) { st.ballTrack = b; st.miss = 0; } else if (cands && ++st.miss > 6) st.ballTrack = null;
  st.aspect = vw / vh;
  return { t, pose: kid, ball: b, snap: snapshot(src, vw, vh, snapW) };
}

// מנגנים את הסרטון לאט, ועוצרים על כל פריים כדי לנתח אותו
// stride(mt) = המרווח המינימלי (בשניות) בין פריימים שמנתחים בזמן mt – צפוף סביב הבעיטה, דליל לפניה
function extractByPlayback(v, { start, end, rot, maxFrames, st, onProgress, stride = () => 0, full = true }) {
  return new Promise(async (resolve, reject) => {
    const frames = [];
    const span = Number.isFinite(end) ? end - start : 0;
    let lastT = -1, done = false, lastCb = performance.now();
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      v.pause();
      resolve(frames);
    };
    // אם הדפדפן נתקע – מסיימים עם מה שיש
    const watchdog = setInterval(() => { if (performance.now() - lastCb > 4000) finish(); }, 1000);
    v.onended = finish;
    const cb = async (now, meta) => {
      if (done) return;
      lastCb = performance.now();
      if (S.cancelProcessing) { done = true; clearInterval(watchdog); v.pause(); return reject(new Error('cancel')); }
      const mt = meta.mediaTime;
      if (mt > end || frames.length >= maxFrames) return finish();
      if (mt < start) { v.playbackRate = 2; v.requestVideoFrameCallback(cb); return; }
      v.playbackRate = 0.5;
      if (mt > lastT + 1e-4 && mt - lastT >= stride(mt) - 1e-4) {
        v.pause();
        lastT = mt;
        try { frames.push(processStill(v, mt * 1000, rot, st, { full })); } catch (e) { console.warn(e); }
        onProgress?.(span > 0 ? (mt - start) / span : Math.min(0.95, frames.length / 200));
        v.requestVideoFrameCallback(cb);
        try { await v.play(); } catch { finish(); }
        return;
      }
      v.requestVideoFrameCallback(cb);
    };
    // קופצים ישר לתחילת החלון במקום לנגן מההתחלה
    if (start > 0.3) {
      const sk = once(v, 'seeked').catch(() => {});
      v.currentTime = Math.max(0, start - 0.15);
      await Promise.race([sk, timeout(1500)]);
    }
    v.requestVideoFrameCallback(cb);
    v.play().catch(reject);
  });
}

// גיבוי לדפדפנים בלי requestVideoFrameCallback: קפיצה בזמן (seek) לכל פריים
async function extractBySeek(v, { start, end, rot, maxFrames, st, onProgress, full = true, snapW }) {
  const dur = Number.isFinite(v.duration) ? v.duration : end;
  const to = Math.min(dur, end);
  const step = Math.max(1 / 60, (to - start) / maxFrames);
  const frames = [];
  for (let ts = start; ts < to; ts += step) {
    if (S.cancelProcessing) throw new Error('cancel');
    await seek(v, ts);
    frames.push(processStill(v, ts * 1000, rot, st, { full, snapW }));
    onProgress?.((ts - start) / (to - start));
  }
  return frames;
}

async function openVideo(src) {
  const v = makeHiddenVideo();
  const url = URL.createObjectURL(src);
  v.src = url;
  v.load();
  const loaded = v.readyState >= 2 ? Promise.resolve() : once(v, 'loadeddata');
  return { v, loaded, close: () => { URL.revokeObjectURL(url); v.remove(); } };
}

// מעבר מדויק (מודל full) על חלון בזמן, בצפיפות שנקבעת ע"י stride
async function densePass(v, opts) {
  if (v.requestVideoFrameCallback) return extractByPlayback(v, opts);
  try { await v.play(); v.pause(); } catch { /* */ }
  return extractBySeek(v, { ...opts, maxFrames: Math.min(opts.maxFrames, 90) });
}

function procProgress(label) {
  return (p, txt) => {
    $('#proc-text').textContent = txt || `${label} ${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    $('#proc-bar').style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  };
}

// סרטון מהגלריה: מעבר מהיר (מודל lite, ~45 פריימים) כדי למצוא את רגע הבעיטה,
// ואז מעבר מדויק רק סביבו. כך גם סרטון Slo-mo ארוך מנותח מהר.
async function analyzeFile(file) {
  unlockSpeech();
  show('processing');
  S.cancelProcessing = false;
  const prog = procProgress('');
  prog(0, 'טוען את המודלים…');
  const vid = await openVideo(file);
  try {
    await Promise.all([loadModels({ onStatus: (t) => prog(0, t) }), loadModels({ full: true, onStatus: (t) => prog(0, t) })]);
    prog(0, 'טוען את הסרטון…');
    await vid.loaded;
    const v = vid.v;
    try { await v.play(); v.pause(); } catch { /* */ }
    const dur = Number.isFinite(v.duration) ? v.duration : 10;
    const maxDur = Math.min(dur, 20);

    // מעבר 1: סריקה מהירה
    const st1 = { ballTrack: null, prevHip: null, miss: 0, aspect: 16 / 9 };
    const coarse = await extractBySeek(v, {
      start: 0, end: maxDur, rot: 0, maxFrames: 45, st: st1, full: false, snapW: CONFIG.snapshotWidth,
      onProgress: (p) => prog(p * 0.35, `מחפש את רגע הבעיטה… ${Math.round(p * 100)}%`),
    });
    const aspect = st1.aspect;
    const rough = analyzeKick(coarse, aspect);
    const step = maxDur / 45;

    // מעבר 2: ניתוח מדויק סביב הבעיטה
    let start, end;
    if (rough.ok) {
      const cT = coarse[rough.contactIdx].t / 1000;
      start = Math.max(0, cT - 4 * step);
      end = Math.min(maxDur, cT + 3 * step);
    } else {
      start = 0;
      end = maxDur;
    }
    const st2 = { ballTrack: rough.ok ? rough.ballRef : null, prevHip: null, miss: 0, aspect };
    const dense = await densePass(v, {
      start, end, rot: 0, maxFrames: rough.ok ? 100 : 160, st: st2,
      stride: () => (end - start) / (rough.ok ? 100 : 160),
      onProgress: (p) => prog(0.35 + p * 0.65, `מנתח את הבעיטה… ${Math.round(p * 100)}%`),
    });
    // מחברים: פריימים מהירים מחוץ לחלון (בשביל ריצת התנופה) + הפריימים המדויקים בתוכו
    const t0 = dense.length ? dense[0].t : start * 1000, t1 = dense.length ? dense[dense.length - 1].t : end * 1000;
    const frames = [...coarse.filter((f) => f.t < t0), ...dense, ...coarse.filter((f) => f.t > t1)].sort((a, b) => a.t - b.t);
    let result = analyzeKick(frames, aspect);
    let shown = frames;
    if (!result.ok && rough.ok) { result = rough; shown = coarse; }
    if (dur > 20) toast('נותחו 20 השניות הראשונות. כדאי לחתוך את הסרטון סביב הבעיטה.', 4000);
    showResults(shown, aspect, result, {});
  } catch (e) {
    if (e.message !== 'cancel') {
      console.error(e);
      toast('לא הצלחתי לקרוא את הסרטון. נסו קובץ אחר.', 4000);
    }
    show('home');
    renderHome();
  } finally {
    vid.close();
  }
}
$('#file-input').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) analyzeFile(f);
});
$('#btn-proc-cancel').addEventListener('click', () => (S.cancelProcessing = true));

// ---------- תוצאות ----------
const viewer = $('#viewer');
const vctx = viewer.getContext('2d');

function showResults(frames, aspect, result, { manualBall = null } = {}) {
  if (S.res) recycle(S.res.frames);
  S.res = { frames, aspect, result, idx: result.ok ? result.contactIdx : 0, playing: false, awaitingBall: false, manualBall };
  show('results');
  viewer.style.aspectRatio = `${aspect}`;
  const range = $('#v-range');
  range.max = String(Math.max(0, frames.length - 1));
  renderResult();
}

function qualityLine(r) {
  const q = r.quality || {};
  const parts = [];
  if (q.fps) parts.push(`נותחו ${q.frames} פריימים, כ-${q.fps} בשנייה סביב הבעיטה`);
  if (q.fps && q.fps < 25) parts.push('קצב נמוך – לדיוק טוב יותר כדאי לצלם בהילוך איטי ולהעלות מהגלריה');
  return parts.join('. ');
}

function fmtMetric(id, m) {
  const v = m.value;
  if (!Number.isFinite(v)) return 'לא נמדד';
  switch (id) {
    case 'runup': return `בערך ${Math.max(1, Math.round(v / 1.6))} צעדים`;
    case 'backswing': return `ברך כפופה עד ${Math.round(v)}°`;
    case 'plant': return v < 0 ? `${Math.abs(v).toFixed(1)} אורך רגל מאחורי הכדור` : `${v.toFixed(1)} אורך רגל לפני הכדור`;
    case 'plantKnee': return `${Math.round(v)}°`;
    case 'lean': return v >= 0 ? `${Math.round(v)}° קדימה` : `${Math.round(-v)}° אחורה`;
    case 'follow': return `${v.toFixed(1)} אורכי רגל אחרי הכדור`;
    default: return String(v);
  }
}

function renderResult() {
  const { result } = S.res;
  const body = $('#res-body');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  $('#viewer-hint').hidden = true;

  if (!result.ok) {
    $('#stars').textContent = '';
    $('#res-title').textContent = 'לא הצלחתי לנתח';
    const msg = errorMessage(result.error, settings.gender);
    body.innerHTML = `<section class="card fb error"><h3>מה קרה?</h3><p>${esc(msg)}</p></section>`;
    if (result.error === 'no-ball' || result.error === 'no-contact') {
      S.res.awaitingBall = true;
      S.res.idx = 0;
      $('#viewer-hint').hidden = false;
      $('#viewer-hint').textContent = g('הקש על הכדור בתמונה (לפני הבעיטה)', 'הקישי על הכדור בתמונה (לפני הבעיטה)');
    }
    speak(msg);
    drawViewer();
    return;
  }

  const fb = buildFeedback(result, settings);
  const { good, total } = result.score;
  $('#stars').textContent = '★'.repeat(good) + '☆'.repeat(Math.max(0, total - good));
  $('#res-title').textContent = fb.opener;
  const li = (arr) => arr.map((x) => `<li>${esc(x.text)}</li>`).join('');
  const rows = Object.entries(result.metrics)
    .map(([id, m]) => {
      const cls = m.status === 'good' || m.status === 'ok' ? 'good' : m.status === 'na' ? 'na' : 'bad';
      const st = { good: '✓ טוב', ok: 'בסדר', na: 'לא נמדד' }[m.status] || 'לשפר';
      return `<tr><td>${METRIC_NAMES[id]}</td><td>${esc(fmtMetric(id, m))}${m.reason ? `<br><small class="note">${esc(m.reason)}</small>` : ''}</td><td class="st ${cls}">${st}</td></tr>`;
    })
    .join('');
  const prev = getHistory()[0];
  addHistory(result);
  let progress = '';
  if (prev && prev.total) {
    const diff = good / total - prev.good / prev.total;
    if (diff > 0.01) progress = `<p>📈 שיפור לעומת הבעיטה הקודמת!</p>`;
  }
  const useAi = settings.ai && aiConfigured();
  body.innerHTML = `
    ${useAi ? `<section class="card ai-status" id="ai-status"><span class="mini-spin"></span> המאמן החכם בודק את התנועה בתמונות…</section>` : ''}
    <div id="fb-cards">
    ${fb.good.length ? `<section class="card fb good"><h3>✅ מה היה טוב</h3><ul>${li(fb.good)}</ul></section>` : ''}
    ${fb.improve.length ? `<section class="card fb improve"><h3>🔧 מה לשפר</h3><ul>${li(fb.improve)}</ul></section>` : ''}
    <section class="card fb keep"><h3>⭐ על מה לשמור</h3><p style="margin:0">${esc(fb.keep)}</p>${progress}</section>
    </div>
    <details class="card"><summary>פירוט המדידות</summary>
      <table class="metrics">${rows}</table>
      <p class="note" style="margin-top:8px">המדידה מבוססת על צילום דו-ממדי מהצד ומשמשת כהכוונה, לא כשיפוט מדויק.</p>
      <p class="note">${esc(qualityLine(result))}</p>
      <button class="btn small" id="btn-copy-data" type="button">📋 העתק נתוני מדידה</button>
    </details>`;
  S.res.speech = fb.speech;
  $('#btn-copy-data').addEventListener('click', async () => {
    const data = {
      app: 'penalty-coach',
      date: new Date().toISOString(),
      quality: result.quality && { fps: result.quality.fps, swaps: result.quality.swaps, frames: result.quality.frames },
      L: +result.L.toFixed(4),
      dir: result.dir,
      metrics: Object.fromEntries(Object.entries(result.metrics).map(([k, m]) => [k, { value: Number.isFinite(m.value) ? +m.value.toFixed(3) : null, status: m.status }])),
    };
    try { await navigator.clipboard.writeText(JSON.stringify(data)); toast('הנתונים הועתקו. אפשר להדביק ולשלוח'); }
    catch { toast('לא הצלחתי להעתיק'); }
  });
  drawViewer();
  if (!useAi) { speak(fb.speech); return; }

  // המאמן החכם: התשובה מחליפה את המשוב האוטומטי. אם נכשל – נשארים עם המשוב האוטומטי.
  const token = (S.res.token = Math.random());
  speak(g('רגע, אני בודק את הבעיטה', 'רגע, אני בודקת את הבעיטה'));
  reviewKick(S.res.frames, result, S.res.aspect, settings)
    .then(({ feedback: ai }) => {
      if (S.res?.token !== token) return;
      const status = $('#ai-status');
      if (!ai.usable) {
        status.innerHTML = `🤖 המאמן החכם: ${esc(ai.problem || 'לא רואים את הבעיטה מספיק טוב בתמונות')}`;
        speak(fb.speech);
        return;
      }
      const L = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
      $('#stars').textContent = '★'.repeat(ai.stars) + '☆'.repeat(5 - ai.stars);
      $('#res-title').textContent = ai.opener;
      $('#fb-cards').innerHTML = `
        ${ai.good?.length ? `<section class="card fb good"><h3>✅ מה היה טוב</h3><ul>${L(ai.good)}</ul></section>` : ''}
        ${ai.improve?.length ? `<section class="card fb improve"><h3>🔧 מה לשפר</h3><ul>${L(ai.improve)}</ul></section>` : ''}
        ${ai.keep ? `<section class="card fb keep"><h3>⭐ על מה לשמור</h3><p style="margin:0">${esc(ai.keep)}</p>${progress}</section>` : ''}`;
      status.textContent = '🤖 המשוב נבדק על ידי המאמן החכם (Claude)';
      status.classList.add('done');
      // עמודת השוואה בטבלת המדידות
      const V = { good: '✓', improve: 'לשפר', unclear: '?' };
      document.querySelectorAll('table.metrics tr').forEach((tr, i) => {
        const id = Object.keys(result.metrics)[i];
        const v = ai.verdicts?.[id];
        tr.insertAdjacentHTML('beforeend', `<td class="st ai">${v ? 'AI ' + V[v] : ''}</td>`);
      });
      S.res.speech = aiSpeech(ai);
      speak(S.res.speech);
    })
    .catch((e) => {
      if (S.res?.token !== token) return;
      console.warn('AI review', e);
      const msg = e.message === 'not-configured'
        ? 'המאמן החכם עוד לא הוגדר בשרת – מוצג משוב אוטומטי'
        : 'המאמן החכם לא זמין כרגע – מוצג משוב אוטומטי';
      const status = $('#ai-status');
      if (status) status.textContent = msg;
      speak(fb.speech);
    });
}

function drawViewer() {
  if (!S.res) return;
  const { frames, result, idx } = S.res;
  const { w, h } = fitCanvas(viewer);
  vctx.fillStyle = '#000';
  vctx.fillRect(0, 0, w, h);
  const f = frames[idx];
  if (!f) return;
  const rect = containRect(f.snap?.width || 16, f.snap?.height || 9, w, h);
  if (f.snap) vctx.drawImage(f.snap, rect.x, rect.y, rect.w, rect.h);
  const kickSide = result.ok ? result.kickSide : null;
  const pose = (result.ok && result.clean?.get(f)) || f.pose;
  drawSkeleton(vctx, pose, rect, { kickSide });
  const ballRef = result.ok ? result.ballRef : S.res.manualBall;
  if (result.ok && idx === result.contactIdx) drawContactMarks(vctx, { ...f, pose }, result, rect);
  drawBall(vctx, f.ball || (idx <= (result.contactIdx ?? 0) ? ballRef : null), rect);
  // מונה פריימים + סימון רגע הבעיטה
  vctx.fillStyle = 'rgba(0,0,0,.55)';
  vctx.fillRect(8, 8, 150, 26);
  vctx.fillStyle = '#fff';
  vctx.font = `bold ${14 * Math.min(2, window.devicePixelRatio || 1)}px system-ui, sans-serif`;
  vctx.textAlign = 'left';
  vctx.textBaseline = 'middle';
  const label = result.ok && idx === result.contactIdx ? '⚽ רגע הבעיטה' : `${idx + 1}/${frames.length}`;
  vctx.fillText(label, 14, 21);
  $('#v-range').value = String(idx);
}

function setIdx(i) {
  if (!S.res) return;
  S.res.idx = Math.max(0, Math.min(S.res.frames.length - 1, i));
  drawViewer();
}
$('#v-range').addEventListener('input', (e) => { stopPlay(); setIdx(Number(e.target.value)); });
$('#v-prev').addEventListener('click', () => { stopPlay(); setIdx(S.res.idx - 1); });
$('#v-next').addEventListener('click', () => { stopPlay(); setIdx(S.res.idx + 1); });
$('#v-contact').addEventListener('click', () => {
  stopPlay();
  if (S.res?.result.ok) setIdx(S.res.result.contactIdx);
});
let playTimer = null;
const SPEEDS = [0.25, 0.5, 1];
let speedIdx = 0;
function stopPlay() {
  clearTimeout(playTimer);
  playTimer = null;
  $('#v-play').textContent = '▶';
}
function playStep() {
  const { frames, idx } = S.res;
  if (idx >= frames.length - 1) return stopPlay();
  // מהירות לפי הזמן האמיתי בין הפריימים, מוכפל בהילוך האיטי שנבחר
  const dt = (frames[idx + 1].t - frames[idx].t) / SPEEDS[speedIdx];
  playTimer = setTimeout(() => {
    setIdx(S.res.idx + 1);
    playStep();
  }, Math.max(16, Math.min(600, dt)));
}
$('#v-play').addEventListener('click', () => {
  if (playTimer) return stopPlay();
  if (S.res.idx >= S.res.frames.length - 1) setIdx(0);
  $('#v-play').textContent = '⏸';
  playStep();
});
$('#v-speed').addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  $('#v-speed').textContent = ['×¼', '×½', '×1'][speedIdx];
});
viewer.addEventListener('click', (ev) => {
  if (!S.res?.awaitingBall) return;
  const f = S.res.frames[S.res.idx];
  if (!f?.snap) return;
  const p = tapToBall(ev, viewer, f.snap.width, f.snap.height);
  if (!p) return;
  const kidH = f.pose ? bodyBox(f.pose)?.h : null;
  const h = kidH ? kidH * 0.13 : 0.05;
  const ball = { x: p.x, y: p.y, w: h / S.res.aspect, h };
  S.res.awaitingBall = false;
  S.res.manualBall = ball;
  const result = analyzeKick(S.res.frames, S.res.aspect, ball);
  S.res.result = result;
  S.res.idx = result.ok ? result.contactIdx : 0;
  renderResult();
});
window.addEventListener('resize', () => {
  if (S.screen === 'results') drawViewer();
});

$('#btn-say').addEventListener('click', () => {
  if (S.res?.speech) speak(S.res.speech);
});
$('#btn-res-home').addEventListener('click', () => {
  stopPlay();
  stopSpeech();
  show('home');
  renderHome();
});
$('#btn-again').addEventListener('click', () => {
  stopPlay();
  stopSpeech();
  openCamera();
});

// ---------- התחלה ----------
$('#btn-camera').addEventListener('click', openCamera);
$('#btn-settings').addEventListener('click', openSettings);
setSpeechEnabled(settings.voice);
renderHome();

// מצב בדיקה: ?test חושף את פונקציית התוצאות לבדיקות אוטומטיות
if (new URLSearchParams(location.search).has('test')) window.__pc = { showResults, analyzeKick };

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}
