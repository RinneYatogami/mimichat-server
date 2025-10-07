import express from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";

const app = express();

/* -----------------------  CORS  ----------------------- */
const ALLOWED_ORIGINS = [
  "https://animekpdtshop.com",
  "https://www.animekpdtshop.com",
  "http://localhost:3000" // test local
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
Bạn là **Aromi** – một học sinh trợ lý ảo lấy cảm hứng từ Blue Archive.
Mục tiêu: hỗ trợ mua hàng/đặt trước/tư vấn sản phẩm cho **Sensei** trên shop Anime-KPDT.

- Dùng **tiếng Việt**, xưng **"em"**, gọi người dùng là **"Sensei"**.
- Vibe dễ thương, lễ phép; câu ngắn, **<=120 từ**; emoji 1–3 là đủ.
- Điều tiết mức thân mật theo Level (Lv1–2 lễ phép; Lv3–4 thân hơn chút; Lv5+ tự nhiên nhưng lịch sự).
- SFW tuyệt đối; không bịa giá/kho. Thiếu dữ liệu → hỏi lại hoặc hướng dẫn liên hệ.
- Nếu câu hỏi ngoài phạm vi cửa hàng, trả lời ngắn gọn và điều hướng về chủ đề hữu ích.
- Mở đầu ack nhẹ (“Vâng ạ!”, “Em hiểu rồi ạ~”) khi phù hợp; đề xuất bước tiếp theo.
`;

/* ------------------  DeepSeek client  ------------------ */
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,     // đặt trên Render
  baseURL: "https://api.deepseek.com"       // DeepSeek endpoint
});
const MODEL = process.env.MODEL || "deepseek-chat"; // model khuyến nghị

function toOpenAIMessages(history = []) {
  return history.slice(-12).map(m => ({
    role: m.role === "me" ? "user" : "assistant",
    content: m.text
  }));
}

/* ------------------------ Routes ----------------------- */
app.get("/", (_, res) => {
  res.type("text/plain").send(`MimiChat + DeepSeek running. Model=${MODEL}. Try /health or POST /api/mimichat`);
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
      model: MODEL,         // deepseek-chat
      temperature: 0.7,
      messages
    });

    const text =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Em đang hơi bận một chút… Sensei chờ em xíu nha~";

    res.json({ reply: text });
  } catch (err) {
    console.error("DeepSeek error:",
      err.status || err.response?.status,
      err.message,
      err.response?.data || err.data || err
    );
    // Trả 200 để UI hiển thị mềm mại
    res.status(200).json({ reply: "Máy chủ bận một lát, Sensei thử lại giúp em nhé." });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log("MimiChat DeepSeek server on", PORT, "model:", MODEL);
});
