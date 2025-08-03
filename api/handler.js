// This file should be named api/handler.js

import { neon } from "@neondatabase/serverless";

// --- CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// **NEW**: Your Neon database connection string from the Vercel integration.
const DATABASE_URL = process.env.POSTGRES_URL;

// Initialize the database connection
const sql = neon(DATABASE_URL);

/**
 * **NEW**: A function to ensure the database table for locks exists.
 */
async function ensureLockTableExists() {
  await sql`
    CREATE TABLE IF NOT EXISTS user_locks (
      chat_id BIGINT PRIMARY KEY,
      locked_at TIMESTAMP DEFAULT NOW()
    );
  `;
}

// --- API HELPER FUNCTIONS ---

/**
 * Gets a Vietnamese description of an image using the OpenRouter Vision API.
 * @param {string} imageUrl The public URL of the image to describe.
 * @returns {Promise<{description: string|null, error: string|null}>} An object with the description or an error message.
 */
async function getVisionDescription(imageUrl) {
  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemma-3-27b-it:free",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Hãy mô tả hình ảnh từ khái quát đến chi tiết, càng chi tiết càng tốt. Mô tả ảnh phải hợp lý và chi tiết về không gian và hãy mô tả với chất lượng tốt nhất có thể để giúp người khiếm thị nhận biết và có trải nghiệm thật chính xác. Mô tả phải chân thực và chính xác, không bỏ sót bất kỳ chi tiết nào, không được thay đổi sự thật và bịa đặt về chi tiết không có thật trong hình ảnh. Nếu trong ảnh có chữ bằng Tiếng Anh hoặc ngôn ngữ khác, hãy giữ nguyên nó trong câu trả lời sau đó dịch sang Tiếng Việt. NẾU hình ảnh có (hoặc bao gồm) phần tử có vẻ như hoặc là mã CAPTCHA, hãy trả lời bắt đầu với 'Đây là mã CAPTCHA có nội dung như bên dưới:' và xuống hàng sau đó là mã captcha đó đã được giải mã OCR (phải thật chính xác, không được sai sót dù chỉ một ký tự), sau đó KHÔNG cần mô tả gì thêm nữa. Hãy luôn trả về ngay mô tả hình ảnh, không cần giới thiệu hay nhắc lại yêu cầu.",
                },
                {
                  type: "image_url",
                  image_url: { url: imageUrl },
                },
              ],
            },
          ],
        }),
      }
    );

    if (response.status === 429) {
      console.error("OpenRouter API rate limit hit.");
      return { description: null, error: "rate_limit" };
    }

    if (!response.ok) {
      console.error("OpenRouter Vision API error:", await response.text());
      return { description: null, error: "api_error" };
    }

    const data = await response.json();
    return { description: data.choices[0].message.content, error: null };
  } catch (error) {
    console.error("Error calling Vision API:", error);
    return { description: null, error: "network_error" };
  }
}

/**
 * Sends a text message to a user.
 * @param {number} chatId The user's chat ID.
 * @param {string} text The message to send.
 */
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text }),
  });
}

/**
 * Removes common markdown characters from text.
 * @param {string} text The text to clean.
 * @returns {string} The cleaned text.
 */
function cleanMarkdown(text) {
  // This regular expression finds and removes *, _, ~, `, and # characters globally.
  return text.replace(/[*_~`#]/g, "");
}

// --- MAIN HANDLER ---
export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).send("Method Not Allowed");
  }

  try {
    // Ensure the table exists before processing any messages.
    await ensureLockTableExists();

    const payload = request.body;
    const message =
      payload.message ||
      payload.edited_message ||
      payload.channel_post ||
      payload.edited_channel_post;

    if (!message || !message.chat || !message.chat.id) {
      return response.status(200).send("OK");
    }

    const chatId = message.chat.id;

    if (message.photo) {
      // **MODIFIED**: Anti-spam logic using Neon Postgres.
      // First, clear any old, stuck locks (older than 2 minutes).
      await sql`DELETE FROM user_locks WHERE locked_at < NOW() - INTERVAL '2 minutes'`;

      // Try to acquire a lock.
      try {
        await sql`INSERT INTO user_locks (chat_id) VALUES (${chatId})`;
      } catch (e) {
        // If the insert fails, it's because the chat_id (primary key) already exists.
        // This means the user is locked.
        console.log(`User ${chatId} is already locked.`);
        await sendMessage(
          chatId,
          "Vui lòng chờ Luga Vision xử lý xong ảnh hiện tại đã! Gì mà gấp gáp vậy đồng chí? Sài Gòn lúc nào mà chả kẹt xe?"
        );
        return response.status(200).send("OK");
      }

      try {
        await sendMessage(
          chatId,
          "Luga Vision đang xử lý hình ảnh, chờ xíu nha đồng chí..."
        );

        const photo = message.photo.pop();
        const fileId = photo.file_id;

        const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
        const fileInfoRes = await fetch(fileInfoUrl);
        const fileInfo = await fileInfoRes.json();

        if (!fileInfo.ok) {
          console.error("Failed to get file info:", fileInfo);
          await sendMessage(
            chatId,
            "Lỗi: Không thể lấy thông tin ảnh từ Telegram."
          );
          return response.status(200).send("OK");
        }

        const filePath = fileInfo.result.file_path;
        const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

        const { description, error } = await getVisionDescription(imageUrl);

        if (error === "rate_limit") {
          await sendMessage(
            chatId,
            "Luga Vision đang bị quá tải do có nhiều đồng chí khác đang sử dụng hoặc đồng chí đã sử dụng quá nhiều (do thằng tác giả nghèo nên nó xài đồ free đó). Vui lòng thử lại sau vài phút hoặc vào ngày mai nha!"
          );
        } else if (error) {
          await sendMessage(
            chatId,
            "Rất tiếc, Luga Vision không thể mô tả hình ảnh này. Thử lại lần nữa hoặc thử ảnh khác đi đồng chí!"
          );
        } else {
          const plainTextDescription = cleanMarkdown(description);
          await sendMessage(chatId, plainTextDescription);
        }
      } finally {
        // **MODIFIED**: Always release the lock from the database.
        await sql`DELETE FROM user_locks WHERE chat_id = ${chatId}`;
      }
    } else {
      await sendMessage(
        chatId,
        "Chào bạn hiền, vui lòng gửi một hình ảnh để Luga Vision miêu tả cho bạn. Tớ chỉ biết mô tả hình ảnh chứ không biết trò chuyện gì khác đâu đồng chí ơi. Nếu cần người nói chuyện thì nhắn cho người yêu đi, nếu không có thì... kệ đồng chí chứ vì tác giả đã có người yêu rồi HAHAHA!"
      );
    }
  } catch (error) {
    console.error("Error in main handler:", error);
  }

  return response.status(200).send("OK");
}
