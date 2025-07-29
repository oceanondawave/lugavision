// --- CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// The URL of your deployed Python conversion API on Koyeb
const CONVERTER_API_URL = process.env.CONVERTER_API_URL;

/**
 * Sends a task to the Koyeb service to process an image.
 * @param {string} imageUrl The public URL of the image.
 * @param {number} chatId The user's chat ID.
 */
async function delegate_task_to_worker(imageUrl, chatId) {
  if (!CONVERTER_API_URL) {
    console.error("CONVERTER_API_URL is not set.");
    return;
  }
  try {
    // We send the task but don't wait for it to finish.
    fetch(`${CONVERTER_API_URL}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, chat_id: chatId }),
    });
  } catch (error) {
    console.error("Error delegating task to worker:", error);
  }
}

/**
 * Sends a simple text message.
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

// --- MAIN HANDLER ---
export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).send("Method Not Allowed");
  }

  try {
    const payload = request.body;
    const message =
      payload.message ||
      payload.edited_message ||
      payload.channel_post ||
      payload.edited_channel_post;

    if (!message || !message.chat || !message.chat.id) {
      return response.status(200).send("OK");
    }

    // Immediately acknowledge the request to prevent Telegram retries.
    response.status(200).send("OK");

    // Now, do the work.
    if (message.photo) {
      const chatId = message.chat.id;
      const photo = message.photo.pop();
      const fileId = photo.file_id;

      // Get the image URL from Telegram
      const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
      const fileInfoRes = await fetch(fileInfoUrl);
      const fileInfo = await fileInfoRes.json();
      const filePath = fileInfo.result.file_path;
      const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

      // Delegate the long-running task to the Koyeb service
      delegate_task_to_worker(imageUrl, chatId);
    } else {
      await sendMessage(
        message.chat.id,
        "Chào bạn hiền, vui lòng gửi một hình ảnh để Luga Vision miêu tả cho bạn. Tớ chỉ biết mô tả hình ảnh chứ không biết trò chuyện gì khác đâu đồng chí ơi."
      );
    }
  } catch (error) {
    console.error("Error in main handler:", error);
  }
}
