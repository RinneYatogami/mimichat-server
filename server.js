// server.js — MimiChat (Aromi) + Groq only
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";

const app = express();

/* ===================== CORS ===================== */
const ALLOWED_ORIGINS = [
  "https://animekpdtshop.com",
  "https://www.animekpdtshop.com",
  "http://localhost:3000",            // test local
];

const corsOptions = {
  origin: (origin, cb) => {
    // Cho phép tool/curl (không gửi Origin)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: false,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

/* ===================== Aromi prompt ===================== */
const sys = `
Bạn là **Aromi** – học sinh trợ lý ảo lấy cảm hứng từ Blue Archive, hỗ trợ mua hàng/đặt trước cho **Sensei** (người dùng) trên shop Anime-KPDT.

- Luôn dùng **tiếng Việt**, xưng **"em"**, gọi **"Sensei"**.
- Vibe dễ thương, lễ phép; câu ngắn gọn; **≤120 từ**; emoji 1–3 là đủ.
- Điều tiết mức thân mật theo Level: Lv1–2 rất lễ phép; Lv3–4 thân hơn; Lv5+ tự nhiên nhưng vẫn lịch sự.
- **SFW** tuyệt đối; không bịa giá/kho. Thiếu dữ liệu → hỏi lại/đưa cách liên hệ.
- Nếu hỏi ngoài phạm vi, trả lời ngắn rồi kéo lại chủ đề hữu ích.
- Thích hợp mở đầu “Vâng ạ!”, “Em hiểu rồi ạ~”; luôn đề xuất bước tiếp theo (chọn mẫu/size/tầm giá…).
`;

/* ===================== Groq (OpenAI-compatible) ===================== */
const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,                // gsk_xxx
  baseURL: "https://api.groq.com/openai/v1",
});

// Model gợi ý, KHÔNG dùng bản đã bị deprecate:
// - llama-3.1-8b-instant (nhẹ, rẻ, phản hồi tốt)
// - có thể set trong ENV: GROQ_MODEL
const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

/* ===================== Utils ===================== */
function toOpenAIMessages(history = []) {
  return history.slice(-12).map((m) => ({
    role: m.role === "me" ? "user" : "assistant",
    content: m.text,
  }));
}

const friendlyFallback =
  "Vâng ạ! Em đang ở đây—Sensei muốn hỏi gì về sản phẩm hay đặt trước ạ?";

/* ===================== Routes ===================== */
app.get("/", (_, res) => {
  res
    .type("text/plain")
    .send(`MimiChat + Groq is running. Model=${MODEL}. Try /health or POST /api/mimichat`);
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.get("/diag", (_, res) => {
  res.json({
    provider: "groq",
    model: MODEL,
    hasKey: Boolean(process.env.GROQ_API_KEY),
  });
});

/* ===================== Chat endpoint ===================== */
app.post("/api/mimichat", async (req, res) => {
  try {
    const { msg, level, history } = req.body || {};
    if (!msg || typeof msg !== "string") {
      return res.status(400).json({ reply: "Sensei nhắn nội dung giúp em nhé ạ~" });
    }

    const messages = [
      { role: "system", content: sys },
      ...toOpenAIMessages(history),
      {
        role: "user",
        content: `Level hiện tại: ${level}. Tin nhắn mới: ${msg}`,
      },
    ];

    const callOnce = () =>
      client.chat.completions.create({
        model: MODEL,
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 220,           // đảm bảo luôn có nội dung trả lời
        messages,
      });

    let completion;
    try {
      completion = await callOnce();
    } catch (e) {
      // Retry nhẹ nếu 429
      if (e?.status === 429) {
        await new Promise((r) => setTimeout(r, 800));
        completion = await callOnce();
      } else {
        throw e;
      }
    }

    const choice = completion?.choices?.[0];
    let text = (choice?.message?.content || "").trim();

    if (!text) text = friendlyFallback;

    return res.json({ reply: text });
  } catch (err) {
    console.error("Groq error:", err?.status || err?.code || "", err?.message || err);
    return res.status(200).json({ reply: friendlyFallback });
  }
});

/* ===================== Start ===================== */
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`MimiChat Groq server on ${PORT}, model=${MODEL}`);
});
