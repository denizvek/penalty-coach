// הקראה בעברית עם הקול המובנה של הטלפון.

let voice = null;
let enabled = true;
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

function pickVoice() {
  if (!supported) return;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => /^(he|iw)([-_]|$)/i.test(v.lang)) || null;
}
if (supported) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export const hasHebrewVoice = () => !!voice;
export const speechSupported = () => supported;
export function setSpeechEnabled(v) {
  enabled = v;
  if (!v && supported) speechSynthesis.cancel();
}

export function speak(text, { interrupt = true, rate = 1 } = {}) {
  if (!enabled || !supported || !text) return Promise.resolve();
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'he-IL';
  if (voice) u.voice = voice;
  u.rate = rate;
  return new Promise((resolve) => {
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

export function stopSpeech() {
  if (supported) speechSynthesis.cancel();
}

// באייפון ההקראה הראשונה חייבת לצאת מלחיצה של המשתמש
export function unlockSpeech() {
  if (!supported) return;
  pickVoice();
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}
