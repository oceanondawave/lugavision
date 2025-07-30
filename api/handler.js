// --- CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// The URL of your deployed Python conversion API on Koyeb
const CONVERTER_API_URL = process.env.CONVERTER_API_URL;

/**
 * Sends a task to the Koyeb service to process an image.
 * @param {string} imageUrl The public URL of the image.
 * @param {number} chatId The user's chat ID.
 * @returns {Promise<boolean>} True if the task was delegated successfully.
 */
async function delegate_task_to_worker(imageUrl, chatId) {
  if (!CONVERTER_API_URL) {
    console.error("CONVERTER_API_URL is not set.");
    return false;
  }
  try {
    const response = await fetch(`${CONVERTER_API_URL}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, chat_id: chatId }),
    });

    // Check if the worker is busy (status 429)
    if (response.status === 429) {
      // The worker has already sent the "please wait" message.
      // We don't need to do anything else.
      console.log("Worker is busy, request acknowledged.");
      return true; // This is a "successful" outcome from the Vercel bot's perspective.
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

    // Acknowledge the request to Telegram immediately to prevent retries.
    response.status(200).send("OK");

    if (message.photo) {
      const chatId = message.chat.id;

      // **FIX**: Send the "processing" message immediately from the fast Vercel bot.
      await sendMessage(
        chatId,
        "Luga Vision đang xử lý hình ảnh, kết quả sẽ được trả về dưới dạng tin nhắn giọng nói siêu ngọt của em gái Google và 1 tệp motahinhanh.txt để đồng chí thoải mái copy nôi dung nếu cần. Chờ xíu nha đồng chí (có thể hơi lâu vì xài hàng free mà, trên đời này có gì là miễn phí ngoài nước mưa và phân chim?)..."
      );

      const photo = message.photo.pop();
      const fileId = photo.file_id;

      // Get the image URL from Telegram
      const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
      const fileInfoRes = await fetch(fileInfoUrl);
      const fileInfo = await fileInfoRes.json();
      const filePath = fileInfo.result.file_path;
      const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

      // Delegate the task to the worker. We don't await this, as it can be slow.
      delegate_task_to_worker(imageUrl, chatId);
    } else {
      await sendMessage(
        message.chat.id,
        "Chào bạn hiền, vui lòng gửi một hình ảnh để Luga Vision miêu tả cho bạn. Tớ chỉ biết mô tả hình ảnh chứ không biết trò chuyện gì khác đâu đồng chí ơi. Nếu cần người nói chuyện thì nhắn cho người yêu đi, nếu không có thì... HAHAHA cái đồ FA!"
      );
    }
  } catch (error) {
    console.error("Error in main handler:", error);
  }
}
