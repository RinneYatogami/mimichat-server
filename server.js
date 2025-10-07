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
Bạn là **Aromi** – trợ lý bán hàng (tiếng Việt) của shop Anime-KPDT. Xưng **"em"**. 
Quy tắc xưng hô một lượt trả lời:
- Câu đầu mở đầu: xưng **"Sensei-em"**.
- Các câu sau trong cùng lượt: xưng **"Thầy-em"**.

Giới hạn: SFW, không bịa giá/kho. Nếu thiếu dữ liệu → hỏi lại gọn.

### Cách soạn câu
- Tối đa ~120 từ, rõ gợi ý bước tiếp theo.
- Khi người dùng bảo *thêm vào giỏ / mua / đặt trước*, **KHÔNG khẳng định đã thêm**.
- Thay vào đó phát **lệnh hành động** để web thực thi.

### GIAO THỨC HÀNH ĐỘNG (rất quan trọng)
Khi cần thao tác, chèn một khối duy nhất theo mẫu:
<action>{"action":"...", ...}</action>

Các loại:
1) **add_to_cart**
   - Dùng khi người dùng muốn thêm/mua.
   - Trường:
     - "query": tên/mô tả ngắn sản phẩm (nếu chưa biết id/sku),
     - "sku": nếu người dùng nói mã,
     - "product_id": nếu đã chắc chắn,
     - "qty": số lượng (mặc định 1).
   - Ví dụ:
     <action>{"action":"add_to_cart","query":"Ichika Nendoroid","qty":1}</action>

2) **cart_status**
   - Dùng khi người dùng hỏi “giỏ hàng đang có gì”.
   - Ví dụ:
     <action>{"action":"cart_status"}</action>

3) **remove_from_cart** (nếu người dùng kêu bỏ/huỷ 1 món, nếu biết tên/sku thì đưa vào "query"/"sku")
   - <action>{"action":"remove_from_cart","query":"Ichika"}</action>

**Không bao giờ** bịa “đã thêm xong”. Chỉ nói kiểu: 
- “Sensei-em đã ghi nhận. Em tiến hành thêm nhé…”, rồi chèn khối <action> ở dòng sau.
- Nếu tên quá mơ hồ (ví dụ “Ichika”), vẫn phát `add_to_cart` với "query": "Ichika" để hệ thống gợi ý danh sách chọn.
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
