// index.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");
const streamifier = require("streamifier");
const { Order } = require("./models/Order"); // ensure model exports correctly
const cloudinary = require("cloudinary").v2;
const axios = require("axios");

// const { notifyAdminNewOrder } = require("./telegram")


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let ADMIN_PUSH_TOKEN = null;
const admin = require("./firebase");
const { notifyAdminNewOrder } = require("./telegram");



// ------------------------------------
// Cloudinary Configuration
// ------------------------------------
if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// ------------------------------------
// MongoDB Connection
// ------------------------------------
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI missing in .env");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB error:", err);
    process.exit(1);
  });

// ------------------------------------
// Multer Memory Setup
// ------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB
});


// Helper function to upload buffer to cloudinary
function uploadBufferToCloudinary(buffer, folder = "prescriptions") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}



//notification firebase
app.post("/api/save-admin-push-token", (req, res) => {
  ADMIN_PUSH_TOKEN = req.body.token;
  console.log("✅ ADMIN PUSH TOKEN SAVED:", ADMIN_PUSH_TOKEN);
  res.json({ success: true });
});

// -----------------------------------
// POST — SAVE ORDER
// -----------------------------------
app.post("/place-order", upload.single("prescription"), async (req, res) => {
  try {
    const {
      shopId,
      shopName,
      customerName,
      customerPhone,
      address,
      note,
      items,
    } = req.body;

    if (!customerName || !customerPhone || !address || !items) {
      return res
        .status(400)
        .json({ error: "Missing required fields: name, phone, address, items" });
    }

    let prescriptionFileUrl = null;

    if (req.file && req.file.buffer) {
      const result = await uploadBufferToCloudinary(
        req.file.buffer,
        "your_app"
      );
      prescriptionFileUrl = result.secure_url;
    }

    const order = new Order({
      orderId: "ORD" + Date.now(),
      shopId: shopId || null,
      shopName: shopName || null,
      customerName,
      customerPhone, // must be like 91XXXXXXXXXX (no +)
      address,
      note,
      items,
      prescriptionFile: prescriptionFileUrl,
    });

    const saved = await order.save();
    await notifyAdminNewOrder();
    console.log("✅ ORDER SAVED:", saved.orderId);

    if (!ADMIN_PUSH_TOKEN) {
      console.log("❌ ADMIN_PUSH_TOKEN IS NULL — push not sent");
    } else {
      console.log("📤 SENDING PUSH TO ADMIN...");

      try {
        const response = await admin.messaging().send({
          token: ADMIN_PUSH_TOKEN,
          notification: {
            title: "🛒 New Order Received",
            body: `Order from ${saved.customerName}`,
          },
          android: {
            priority: "high",
          },
          webpush: {
            headers: {
              Urgency: "high",
            },
          },
        });

        console.log("✅ PUSH SENT SUCCESSFULLY:", response);
      } catch (err) {
        console.error("❌ PUSH FAILED:", err);
      }
    }

    res.status(201).json({
      success: true,
      order: saved,
      orderId: saved.orderId,
    });
  } catch (err) {
    console.error("Order save error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------------
// GET — FETCH ALL ORDERS (Admin)
// -----------------------------------
app.get("/api/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    console.error("Fetch orders error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// -----------------------------------
// PUT — MARK ORDER COMPLETED
// -----------------------------------
app.put("/api/orders/:id/complete", async (req, res) => {
  try {
    await Order.findByIdAndUpdate(req.params.id, {
      status: "completed",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Complete error:", err);
    res.status(500).json({ success: false });
  }
});

// -----------------------------------
// PUT — CANCEL ORDER
// -----------------------------------
app.put("/api/orders/:id/cancel", async (req, res) => {
  try {
    await Order.findByIdAndUpdate(req.params.id, {
      status: "cancelled",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Cancel error:", err);
    res.status(500).json({ success: false });
  }
});

// -----------------------------------
// Helper — Send WhatsApp Text via Cloud API
// -----------------------------------
async function sendWhatsAppText(to, body) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      console.error(
        "WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID missing in .env"
      );
      return;
    }

    const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const response = await axios.post(url, payload, { headers });
    console.log("WhatsApp message sent:", response.data);
  } catch (error) {
    console.error(
      "WhatsApp send error:",
      error.response?.data || error.message
    );
  }
}

// -----------------------------------
// POST — SEND WHATSAPP NOTIFICATION (META CLOUD API)
// -----------------------------------
// Trigger this from admin when you have set price etc.
app.post("/api/orders/:id/notify", async (req, res) => {
  try {
    const { totalPrice, customMessage } = req.body;

    // Find order by Mongo _id
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // Optionally update totalPrice in DB
    if (totalPrice !== undefined) {
      order.totalPrice = totalPrice;
    }

    // Optional: update status
    if (!order.status || order.status === "new") {
      order.status = "pending_confirmation";
    }

    await order.save();

    const to = order.customerPhone; // Must be 91XXXXXXXXXX (no +)
    if (!to) {
      return res
        .status(400)
        .json({ success: false, error: "Order has no customerPhone" });
    }

    // Build default message if customMessage not provided
    const msg =
      customMessage ||
      `Hi ${order.customerName || ""},\n` +
        `We received your order (ID: ${order.orderId}).\n` +
        (order.items ? `Items: ${order.items}\n` : "") +
        (order.totalPrice
          ? `Total amount: ₹${order.totalPrice}\n`
          : "") +
        `Please reply *YES* on WhatsApp to confirm your order.`;

    await sendWhatsAppText(to, msg);

    res.json({
      success: true,
      message: "WhatsApp notification triggered",
      orderId: order.orderId,
    });
  } catch (err) {
    console.error("Notify error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: "Status required" });
    }

    await Order.findByIdAndUpdate(req.params.id, { status });
    res.json({ success: true });
  } catch (err) {
    console.error("Status update error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE — PERMANENTLY DELETE ORDER
app.delete("/api/orders/:id", async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete order error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


// -----------------------------------
// TEST ROUTE
// -----------------------------------
app.get("/", (req, res) => {
  res.send("Backend is running...");
});

// -----------------------------------
// START SERVER
// -----------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
