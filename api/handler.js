// --- CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// The URL of your deployed Python conversion API on Koyeb
const CONVERTER_API_URL = process.env.CONVERTER_API_URL;

// --- API HELPER FUNCTIONS ---

/**
 * Gets a Vietnamese description of an image using the OpenRouter Vision API.
 * @param {string} imageUrl The public URL of the image to describe.
 * @returns {Promise<string|null>} The description text or null on failure.
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
                  text: "Hãy mô tả hình ảnh từ khái quát đến chi tiết, càng chi tiết càng tốt. Mô tả ảnh phải hợp lý và chi tiết về không gian và hãy mô tả với chất lượng tốt nhất có thể để giúp người khiếm thị nhận biết và có trải nghiệm thật chính xác. Mô tả phải chân thực và chính xác, không bỏ sót bất kỳ chi tiết nào, không được thay đổi sự thật và bịa đặt về chi tiết không có thật trong hình ảnh. Nếu trong ảnh có chữ bằng Tiếng Anh hoặc ngôn ngữ khác, hãy giữ nguyên nó trong câu trả lời sau đó dịch sang Tiếng Việt. Hãy luôn trả về ngay mô tả hình ảnh, không cần giới thiệu hay nhắc lại yêu cầu.",
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

    if (!response.ok) {
      console.error("OpenRouter Vision API error:", await response.text());
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error calling Vision API:", error);
    return null;
  }
}

/**
 * Removes common markdown characters from text for cleaner TTS output.
 * @param {string} text The text to clean.
 * @returns {string} The cleaned text.
 */
function cleanMarkdownForTts(text) {
  return text.replace(/[*_~`#]/g, "");
}

/**
 * Sends text to the conversion API and gets back OGG audio data.
 * @param {string} text The text to convert.
 * @returns {Promise<Blob|null>} A Blob containing the OGG audio data or null on failure.
 */
async function getOggAudioFromConverter(text) {
  if (!CONVERTER_API_URL) {
    console.error("CONVERTER_API_URL is not set.");
    return null;
  }
  try {
    const response = await fetch(`${CONVERTER_API_URL}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text }),
    });
    if (!response.ok) {
      console.error("Error from conversion API:", await response.text());
      return null;
    }
    return await response.blob();
  } catch (error) {
    console.error("Error calling conversion API:", error);
    return null;
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
 * Sends an OGG audio file as a playable voice message.
 * @param {number} chatId The user's chat ID.
 * @param {Blob} oggAudioBlob The OGG audio data.
 */
async function sendVoice(chatId, oggAudioBlob) {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("voice", oggAudioBlob, "voice.ogg");

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVoice`;
  await fetch(url, { method: "POST", body: formData });
}

/**
 * Sends a text file to a user.
 * @param {number} chatId The user's chat ID.
 * @param {string} textContent The text to put inside the file.
 */
async function sendDocument(chatId, textContent) {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  const textBlob = new Blob([textContent], { type: "text/plain" });
  formData.append("document", textBlob, "motahinhanh.txt");

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
  await fetch(url, { method: "POST", body: formData });
}

// This function contains the long-running logic.
async function processImage(message) {
  const chatId = message.chat.id;

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
    const filePath = fileInfo.result.file_path;

    const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

    const description = await getVisionDescription(imageUrl);
    if (!description) {
      await sendMessage(
        chatId,
        "Rất tiếc, Luga Vision không thể mô tả hình ảnh này (chắc do hết lượt dùng trong ngày rồi, mai thử lại nha, do thằng tác giả nghèo nên nó xài đồ free đó). Thử lại lần nữa hoặc thử ảnh khác đi đồng chí!"
      );
      return;
    }

    const plainTextDescription = cleanMarkdownForTts(description);
    const customText =
      "\nĐồng chí còn ảnh nào khác không? Làm khó Luga Vision thử xem!";
    const fullDescriptionForAudio = plainTextDescription + customText;

    const audio = await getOggAudioFromConverter(fullDescriptionForAudio);
    if (!audio) {
      await sendMessage(
        chatId,
        `Luga Vision đã gặp lỗi khi đọc cho bạn mô tả (chắc do thằng tác giả nghèo nên nó xài server free, thông cảm đi mà), nên mình gửi cho bạn nội dung dưới dạng tin nhắn nè:\n\n${plainTextDescription}`
      );
      return;
    }

    await sendVoice(chatId, audio);
    await sendDocument(chatId, plainTextDescription);
  } catch (error) {
    console.error("Error in processImage:", error);
    await sendMessage(
      chatId,
      "Đã xảy ra lỗi. Vui lòng thử lại đi đồng chí (thử lại không được thì do thằng tác giả nghèo nên nó xài server free nên có giới hạn, thông cảm cho tớ nhé)."
    );
  }
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
      console.log("Received a non-message update, ignoring.");
      return response.status(200).send("OK");
    }

    // **FIX**: The logic has been restructured to prevent multiple responses.
    if (message.photo) {
      // If it's a photo, respond immediately to Telegram to prevent retries.
      response.status(200).send("OK");
      // Then, start the long-running image processing without waiting for it to finish.
      processImage(message);
    } else {
      // If it's NOT a photo, send the help message first.
      await sendMessage(
        message.chat.id,
        "Chào bạn hiền, vui lòng gửi một hình ảnh để Luga Vision miêu tả cho bạn. Tớ chỉ biết mô tả hình ảnh chứ không biết trò chuyện gì khác đâu đồng chí ơi."
      );
      // Then, send the success response.
      return response.status(200).send("OK");
    }
  } catch (error) {
    console.error("Error in main handler:", error);
    // If an error happens in the initial handling, send a generic response.
    return response.status(200).send("OK");
  }
}
