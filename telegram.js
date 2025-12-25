const axios = require("axios");

async function notifyAdminNewOrder(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("❌ Telegram env variables missing");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const message = `
🛒 *New Order Arrived!*

👤 Name: ${order.customerName}
📞 Phone: ${order.customerPhone}
📍 Address: ${order.address}

🆔 Order ID: ${order.orderId}

👉 Check admin panel:
https://hrishi-service-frontend.vercel.app/admin
  `;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
    });
    console.log("✅ Telegram notification sent");
  } catch (error) {
    console.error("❌ Telegram error:", error.response?.data || error.message);
  }
}

module.exports = { notifyAdminNewOrder };
