// --- CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// The URL of your deployed Python service on Appliku
const WORKER_API_URL = process.env.CONVERTER_API_URL;

/**
 * Sends a task to the worker service to process an image.
 * This function fires the request and does not wait for a response.
 * @param {string} imageUrl The public URL of the image.
 * @param {number} chatId The user's chat ID.
 */
function delegate_task_to_worker(imageUrl, chatId) {
  if (!WORKER_API_URL) {
    console.error("CONVERTER_API_URL is not set.");
    return;
  }
  // Fire-and-forget: We send the request but don't use 'await'.
  // This lets the Vercel function finish instantly.
  fetch(`${WORKER_API_URL}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, chat_id: chatId }),
  }).catch((error) => {
    // We log the error, but don't block the function.
    console.error("Error delegating task to worker:", error);
  });
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

    // Immediately respond to Telegram to prevent retries.
    response.status(200).send("OK");

    if (message.photo) {
      const chatId = message.chat.id;
      const photo = message.photo.pop();
      const fileId = photo.file_id;

      // Get the image URL from Telegram
      const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
      const fileInfoRes = await fetch(fileInfoUrl);
      const fileInfo = await fileInfoRes.json();

      if (!fileInfo.ok) {
        console.error("Failed to get file info from Telegram:", fileInfo);
        return;
      }

      const filePath = fileInfo.result.file_path;
      const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

      // Delegate the long-running task to the worker service (fire-and-forget)
      delegate_task_to_worker(imageUrl, chatId);
    } else {
      // For text messages, the reply is fast, so we can await it.
      await sendMessage(
        message.chat.id,
        "Chào bạn hiền, vui lòng gửi một hình ảnh để Luga Vision miêu tả cho bạn. Tớ chỉ biết mô tả hình ảnh chứ không biết trò chuyện gì khác đâu đồng chí ơi. Nếu cần người nói chuyện thì nhắn cho người yêu đi, nếu không có thì... HAHAHA cái đồ FA!"
      );
    }
  } catch (error) {
    console.error("Error in main handler:", error);
  }
}
