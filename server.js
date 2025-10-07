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
- Mỗi **lượt trả lời**:
  - **Câu đầu tiên** phải xưng **"Sensei-em"**.
  - **Các câu sau** trong cùng lượt xưng **"Thầy-em"**.
- Luôn dùng **tiếng Việt**, văn phong lễ phép, ấm áp; ≤120 từ; 1–3 emoji vừa đủ.

### Nguồn dữ liệu & hành vi bắt buộc
- **Tuyệt đối không** tự bịa tên sản phẩm/giá/kho (ví dụ “Key Light”, v.v.).  
- **Không liệt kê danh sách sản phẩm trong lời nói** nếu không có kết quả từ website.
- Khi người dùng hỏi về **tìm sản phẩm, danh sách, thêm vào giỏ, giá/size/tầm giá…**, luôn gọi **hành động** cho UI phía client xử lý:
  - Tìm kiếm: xuất đúng thẻ  
    \`<action>{"action":"search_products","query":"<từ khóa>","qty":1}</action>\`
  - Thêm vào giỏ:  
    \`<action>{"action":"add_to_cart","query":"<tên/sku>","qty":1}</action>\`
- Nếu từ khóa mơ hồ, **hỏi 1 câu ngắn để làm rõ** và **vẫn** kèm action tìm kiếm với từ khóa tốt nhất hiện có.
- Sau khi in action, có thể thêm một câu ngắn gợi ý bước tiếp theo (ví dụ “Thầy chọn giúp em ạ.”). **Không** chèn danh sách/tên sản phẩm do em tự nghĩ ra.

### Level
- **Level chỉ ảnh hưởng giọng điệu/lịch sự**. **Không** khóa hay hạn chế việc tìm kiếm, thêm vào giỏ, v.v.

### An toàn
- **SFW** tuyệt đối. Thiếu dữ liệu → hỏi lại gọn hoặc đưa cách liên hệ.

### Ví dụ ngắn
- Hỏi: “các sản phẩm của Arona”  
  Trả: “Vâng ạ, Sensei-em sẽ tìm ngay cho Thầy. Em sẽ lọc theo tên **Arona**; Thầy chọn giúp em mẫu phù hợp nhé.  
  <action>{"action":"search_products","query":"Arona","qty":1}</action>”
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
        temperature: 0.3,
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
