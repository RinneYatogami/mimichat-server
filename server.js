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
  "http://localhost:3000", // test local
];

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // tool/curl
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
Bạn là **Aromi** – học sinh trợ lý ảo lấy cảm hứng từ Blue Archive, hỗ trợ mua hàng/đặt trước cho Thầy trên shop Anime-KPDT.

### Xưng hô
- Câu đầu mỗi lượt trả lời: xưng **"Sensei-em"** (ví dụ “Vâng ạ, Sensei… Em…”).
- Các câu sau trong **cùng lượt** chuyển sang **"Thầy-em"**.
- Luôn dùng tiếng Việt, câu ngắn gọn, ≤120 từ, 1–3 emoji nhẹ.

### Luật "thêm vào giỏ"
- **Chỉ chèn action add_to_cart** khi Thầy đã xác nhận **rõ sản phẩm** (có SKU, hoặc tên đầy đủ kiểu “Nendoroid Ichika 1234”, “Key Light Ichika”).
- Nếu Thầy chỉ nói tên nhân vật (ví dụ: “Thêm Ichika vào giỏ”), **không được nói đã thêm**. Hãy **hỏi 1 câu làm rõ** (loại hàng: Nendoroid/scale/key light…, hoặc xin link/SKU), rồi chờ câu trả lời.
- Khi đã chắc chắn: chèn 1 action dạng:
  <action>{"action":"add_to_cart","sku":"...", "qty":1}</action>
  hoặc dùng {"query":"tên rõ ràng"} nếu không có SKU.
- Nếu Thầy chỉ đưa từ khóa chung và muốn gợi ý, có thể chèn:
  <action>{"action":"search","query":"Ichika"}</action>
  (client sẽ hiện danh sách gợi ý để Thầy chọn).

### Cách trả lời
- Mở đầu “Vâng ạ, Sensei…” sau đó trong đoạn tiếp theo chuyển “Thầy-em”.
- Tóm tắt 1–2 câu + **đề xuất bước tiếp theo** (chọn loại/size/giá tầm…).
- SFW, không bịa kho/giá; nếu thiếu dữ liệu, xin thêm thông tin.
`;


/* ===================== Groq (OpenAI-compatible) ===================== */
const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY, // gsk_xxx
  baseURL: "https://api.groq.com/openai/v1",
});

// Model gợi ý (đảm bảo còn hỗ trợ)
const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

/* ===================== Utils ===================== */
function toOpenAIMessages(history = []) {
  return history.slice(-12).map((m) => ({
    role: m.role === "me" ? "user" : "assistant",
    content: m.text,
  }));
}

// Hậu xử lý: câu đầu dùng "Sensei", các câu sau dùng "Thầy"
function enforceSenseiThenThay(text = "") {
  let s = (text || "").trim();
  if (!s) return s;

  // Tách câu khá an toàn
  const parts = s.split(/(?<=[.!?…。！？」])\s+|(?<=\n)\s*/).filter(Boolean);
  if (parts.length === 0) return s;

  // CÂU ĐẦU: đảm bảo có "Sensei" (nếu thấy "Thầy" ở câu đầu thì đổi 1 lần)
  let first = parts[0];
  if (/Thầy/.test(first) && !/Sensei/i.test(first)) {
    first = first.replace("Thầy", "Sensei"); // đổi 1 lần đầu
  }
  if (!/Sensei/i.test(first)) {
    // Không có cả Thầy lẫn Sensei → thêm Sensei trang nhã
    first = first.replace(/^\s*/, "Sensei ơi, ");
  }
  parts[0] = first;

  // CÁC CÂU SAU: đổi tất cả "Sensei" → "Thầy"
  for (let i = 1; i < parts.length; i++) {
    parts[i] = parts[i].replace(/Sensei/gi, "Thầy");
    // chống lỗi "Thầy (Sensei)" nếu model lỡ sinh
    parts[i] = parts[i].replace(/\(Sensei\)/gi, "").replace(/\s{2,}/g, " ").trim();
  }

  return parts.join(" ");
}

const friendlyFallback =
  "Vâng ạ, Sensei! Em đang ở đây—Thầy muốn hỏi gì về sản phẩm hay đặt trước ạ?";

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
        max_tokens: 220,
        messages,
      });

    let completion;
    try {
      completion = await callOnce();
    } catch (e) {
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

    // BẮT BUỘC: câu đầu "Sensei", các câu sau "Thầy"
    text = enforceSenseiThenThay(text);

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
