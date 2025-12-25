const axios = require("axios");

async function notifyAdminNewOrder() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("❌ Telegram env variables missing");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: "🛒 New order arrived!\nPlease check the admin panel.\n\n https://hrishi-service-frontend.vercel.app/admin",
    });
    console.log("✅ Telegram notification sent");
  } catch (error) {
    console.error("❌ Telegram error:", error.response?.data || error.message);
  }
}

module.exports = { notifyAdminNewOrder };
