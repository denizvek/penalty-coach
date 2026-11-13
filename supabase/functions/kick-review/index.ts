// פונקציית שרת (Supabase Edge Function): מקבלת 4–6 פריימים מרכזיים של בעיטה + המדידות של האפליקציה,
// שולחת אותם למודל הראייה של Claude, ומחזירה משוב מאמן בעברית במבנה קבוע.
// מפתח ה-API נשמר כסוד בשרת (ANTHROPIC_API_KEY) ולא מגיע לטלפון.

const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("KICK_MODEL") ?? "claude-sonnet-5-5";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://denizvek.github.io,http://localhost:8765,http://127.0.0.1:8765").split(",");

const MAX_FRAMES = 6;
const MAX_IMAGE_B64 = 350_000; // ~260KB לתמונה

function cors(origin: string | null) {
  const ok = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Vary": "Origin",
  };
}

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });

const METRIC_IDS = ["runup", "backswing", "plant", "plantKnee", "lean", "follow"];

const TOOL = {
  name: "kick_feedback",
  description: "משוב מאמן על בעיטת פנדל של ילד, על סמך הפריימים והמדידות.",
  input_schema: {
    type: "object",
    properties: {
      usable: {
        type: "boolean",
        description: "false אם בתמונות לא רואים בעיטה ברורה (ילד לא בתמונה, אין כדור, צילום מלפנים וכו')",
      },
      problem: { type: "string", description: "אם usable=false: משפט קצר בעברית מה לתקן בצילום" },
      opener: { type: "string", description: "משפט פתיחה קצר ומעודד, עד 6 מילים" },
      good: {
        type: "array",
        maxItems: 2,
        items: { type: "string" },
        description: "עד 2 דברים שנעשו טוב, משפט קצר ופשוט לכל אחד",
      },
      improve: {
        type: "array",
        maxItems: 2,
        items: { type: "string" },
        description: "עד 2 דברים לשפר: מה ראית ואיך לתקן, בשפה של ילד. רק אם רואים את זה בבירור בתמונות",
      },
      keep: { type: "string", description: "דבר אחד לשמור עליו בבעיטה הבאה" },
      verdicts: {
        type: "object",
        description: "לכל מדד: האם לפי התמונות הוא טוב, צריך שיפור, או שאי אפשר לדעת",
        properties: Object.fromEntries(
          METRIC_IDS.map((id) => [id, { type: "string", enum: ["good", "improve", "unclear"] }]),
        ),
      },
      stars: { type: "integer", minimum: 1, maximum: 5, description: "ציון כללי לטכניקה, 1–5" },
    },
    required: ["usable", "opener", "good", "improve", "keep", "verdicts", "stars"],
  },
};

function systemPrompt(gender: string, name: string, age: string) {
  const form = gender === "f" ? "בלשון נקבה (את, בעטת, נסי)" : "בלשון זכר (אתה, בעטת, נסה)";
  return `אתה מאמן כדורגל לילדים, מומחה לטכניקת בעיטה. אתה מקבל פריימים מסרטון של ילד${age ? ` בן ${age}` : ""} שבועט פנדל, מצולם מהצד,
עם שלד שצויר עליהם בזיהוי אוטומטי (צהוב = רגל הבעיטה, תכלת = רגל התמיכה, עיגול כתום = הכדור). השלד יכול לטעות – סמוך על מה שאתה רואה בתמונה.
בנוסף מצורפות מדידות אוטומטיות מצילום דו-ממדי. הן רועשות: השתמש בהן כרמז בלבד, ואם התמונה מראה אחרת – התמונה קובעת.

מה לבדוק:
- רגל התמיכה: לצד הכדור (בערך כף רגל אחת לצדו), מצביעה למטרה, לא רחוק מאחוריו ולא לפניו.
- הגוף ברגע הבעיטה: מעל הכדור או מעט קדימה. נטייה ברורה לאחור מרימה את הכדור.
- רגל הבעיטה: הנפה לאחור עם ברך כפופה, ופגיעה עם הקרסול נעול.
- המשך תנועה של רגל הבעיטה לכיוון המטרה אחרי הפגיעה.
- ריצת תנופה: כמה צעדים, בזווית קלה לכדור.
- ידיים פתוחות לשיווי משקל.

כללים:
- כתוב בעברית פשוטה לילד, ${form}${name ? `, פנה בשם "${name}" רק בפתיחה` : ""}.
- רק דברים שרואים בבירור בתמונות. אם משהו לא ברור – אל תעיר עליו (verdict = unclear).
- לכל היותר 2 נקודות לשיפור, החשובות ביותר. משפט אחד לכל נקודה: מה לעשות, לא רק מה לא בסדר.
- היה מעודד וכן. בלי מספרים ובלי מונחים טכניים.
- אל תתאר את מראה הילד, את הבגדים או את הפנים. דבר רק על התנועה.
החזר את התשובה רק דרך הכלי kick_feedback.`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  // רק מהאתר של האפליקציה (לא מגן מפני כל שימוש לרעה, אבל חוסם שימוש מאתרים אחרים)
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403, origin);
  if (!API_KEY) return json({ error: "not-configured" }, 503, origin);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad-json" }, 400, origin);
  }
  const frames = Array.isArray(body?.frames) ? body.frames.slice(0, MAX_FRAMES) : [];
  if (frames.length < 2) return json({ error: "few-frames" }, 400, origin);
  for (const f of frames) {
    if (typeof f?.image !== "string" || f.image.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(f.image)) {
      return json({ error: "bad-image" }, 400, origin);
    }
  }
  const gender = body?.gender === "f" ? "f" : "m";
  const name = String(body?.name ?? "").slice(0, 20).replace(/[<>"`]/g, "");
  const age = String(body?.age ?? "").replace(/\D/g, "").slice(0, 2);
  const metrics = JSON.stringify(body?.metrics ?? {}).slice(0, 2000);
  const kickSide = body?.kickSide === "left" || body?.kickSide === "right" ? body.kickSide : "unknown";

  const content: any[] = [];
  frames.forEach((f: any, i: number) => {
    content.push({ type: "text", text: `פריים ${i + 1}: ${String(f.label ?? "").slice(0, 60)}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.image } });
  });
  content.push({
    type: "text",
    text: `מדידות אוטומטיות (יחידות: אורכי רגל של הילד; זוויות במעלות; סטטוס לפי ספים קבועים):\n${metrics}\nרגל הבעיטה לפי הזיהוי: ${kickSide}.\nתן משוב על הבעיטה.`,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: systemPrompt(gender, name, age),
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("anthropic", res.status, t.slice(0, 500));
      return json({ error: "upstream", status: res.status }, 502, origin);
    }
    const data = await res.json();
    const tool = (data.content ?? []).find((c: any) => c.type === "tool_use");
    if (!tool) return json({ error: "no-output" }, 502, origin);
    return json({ ok: true, model: MODEL, feedback: tool.input }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: ctrl.signal.aborted ? "timeout" : "fetch" }, 504, origin);
  } finally {
    clearTimeout(timer);
  }
});
