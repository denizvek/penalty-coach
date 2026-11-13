// הגדרות והיסטוריה – נשמרים בטלפון בלבד (localStorage).

const SETTINGS_KEY = 'pc.settings';
const HISTORY_KEY = 'pc.history';

const DEFAULTS = { name: '', age: '', gender: 'm', voice: true, debug: false, facing: 'environment', ai: true };

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* מצב פרטי – לא נורא */
  }
}

export const getSettings = () => ({ ...DEFAULTS, ...read(SETTINGS_KEY, {}) });
export const saveSettings = (s) => write(SETTINGS_KEY, s);

export const getHistory = () => read(HISTORY_KEY, []);
export function addHistory(result) {
  const h = getHistory();
  h.unshift({
    date: Date.now(),
    good: result.score.good,
    total: result.score.total,
    statuses: Object.fromEntries(Object.entries(result.metrics).map(([k, m]) => [k, m.status])),
  });
  write(HISTORY_KEY, h.slice(0, 50));
  return h;
}
export const clearHistory = () => write(HISTORY_KEY, []);
