// --- CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// The URL of your deployed Python service on Koyeb
const WORKER_API_URL = process.env.CONVERTER_API_URL;

/**
 * Sends a task to the Koyeb service to process an image.
 * @param {string} imageUrl The public URL of the image.
 * @param {number} chatId The user's chat ID.
 * @returns {Promise<boolean>} True if the task was delegated successfully.
 */
async function delegate_task_to_worker(imageUrl, chatId) {
  if (!WORKER_API_URL) {
    console.error("CONVERTER_API_URL is not set.");
    return false;
  }
  try {
    const response = await fetch(`${WORKER_API_URL}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, chat_id: chatId }),
    });

    // If the worker is busy (status 429), it has already sent the "please wait" message.
    // We don't need to do anything else.
    if (response.status === 429) {
      console.log("Worker is busy, request acknowledged by worker.");
      return true;
    }

    if (!response.ok) {
      console.error("Error from worker service:", await response.text());
      return false;
    }

    return true; // Success
  } catch (error) {
    console.error("Error delegating task to worker:", error);
    return false;
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

    if (message.photo) {
      const chatId = message.chat.id;

      // **FIX**: Send the "processing" message immediately from the fast Vercel bot.
      await sendMessage(
        chatId,
        "Luga Vision đang xử lý hình ảnh, chờ xíu nha đồng chí..."
      );

      const photo = message.photo.pop();
      const fileId = photo.file_id;

      // Get the image URL from Telegram
      const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
      const fileInfoRes = await fetch(fileInfoUrl);
      const fileInfo = await fileInfoRes.json();

      if (!fileInfo.ok) {
        console.error("Failed to get file info from Telegram:", fileInfo);
        return response.status(200).send("OK");
      }

      const filePath = fileInfo.result.file_path;
      const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

      // Delegate the task to the worker.
      const success = await delegate_task_to_worker(imageUrl, chatId);

      if (!success) {
        // If the delegation failed for a reason other than "busy", notify the user.
        await sendMessage(
          chatId,
          "Lỗi hệ thống, không thể bắt đầu xử lý. Vui lòng thử lại sau."
        );
      }

      // Now, we can safely respond to Telegram.
      return response.status(200).send("OK");
    } else {
      await sendMessage(
        message.chat.id,
        "Chào bạn hiền, vui lòng gửi một hình ảnh để Luga Vision miêu tả cho bạn. Tớ chỉ biết mô tả hình ảnh chứ không biết trò chuyện gì khác đâu đồng chí ơi. Nếu cần người nói chuyện thì nhắn cho người yêu đi, nếu không có thì... HAHAHA cái đồ FA!"
      );
      return response.status(200).send("OK");
    }
  } catch (error) {
    console.error("Error in main handler:", error);
    if (!response.headersSent) {
      response.status(200).send("OK");
    }
  }
}
