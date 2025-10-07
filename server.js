import express from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";

const app = express();

/* -----------------------  CORS  ----------------------- */
const ALLOWED_ORIGINS = [
  "https://animekpdtshop.com",
  "https://www.animekpdtshop.com",
  "http://localhost:3000"
];
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  }
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

/* ------------------  AROMI prompt  ------------------ */
const sys = `
Bạn là **Aromi** – trợ lý ảo lấy cảm hứng từ Blue Archive. ...
(giữ nguyên phần system prompt như bạn đang dùng)
`;

/* ---------------  Provider selection via ENV  --------------- */
const PROVIDER = (process.env.LLM_PROVIDER || "openrouter").toLowerCase();

let baseURL = "";
let apiKey = "";
let defaultModel = "";

if (PROVIDER === "deepseek") {
  baseURL = "https://api.deepseek.com";
  apiKey = process.env.DEEPSEEK_API_KEY || "";
  defaultModel = "deepseek-chat";
} else if (PROVIDER === "openai") {
  baseURL = "https://api.openai.com/v1";
  apiKey = process.env.OPENAI_API_KEY || "";
  defaultModel = "gpt-4o-mini";
} else {
  // openrouter (default)
  baseURL = "https://openrouter.ai/api/v1";
  apiKey = process.env.OPENROUTER_API_KEY || "";
  defaultModel = "openai/gpt-4o-mini";
}

const MODEL = process.env.MODEL || process.env.OPENROUTER_MODEL || defaultModel;

if (!apiKey) {
  console.warn(`[WARN] Missing API key for provider ${PROVIDER}. Set the right env var.`);
}

const client = new OpenAI({ apiKey, baseURL });

/* --------------- Utils --------------- */
function toOpenAIMessages(history = []) {
  return history.slice(-12).map(m => ({
    role: m.role === "me" ? "user" : "assistant",
    content: m.text
  }));
}

/* --------------- Routes --------------- */
app.get("/", (_, res) => {
  res.type("text/plain").send(
    `MimiChat Server is running. Provider=${PROVIDER}, model=${MODEL}. Try /health or POST /api/mimichat`
  );
});
app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/api/mimichat", async (req, res) => {
  try {
    const { msg, level, history } = req.body || {};
    if (typeof msg !== "string" || !msg.trim()) {
      return res.status(400).json({ reply: "Sensei nhắn nội dung giúp em nhé ạ~" });
    }

    const messages = [
      { role: "system", content: sys },
      ...toOpenAIMessages(history),
      { role: "user", content: `Level hiện tại: ${level}. Tin nhắn mới: ${msg}` }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      messages
    });

    const text =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Em đang hơi bận một chút… Sensei chờ em xíu nha~";

    res.json({ reply: text });
  } catch (err) {
    console.error("LLM error:",
      err.status || err.response?.status,
      err.message,
      err.response?.data || err.data || err
    );
    res.status(200).json({ reply: "Máy chủ bận một lát, Sensei thử lại giúp em nhé." });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`MimiChat server on ${PORT}, provider=${PROVIDER}, model=${MODEL}`);
});
