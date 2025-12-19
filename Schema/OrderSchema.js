const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true }, // include +country code e.g. +91...
  shopId: { type: String },        // optional: id of shop selected
  shopName: { type: String },      // optional: shop name
  items: { type: [String], required: true },  // stringified items or simple text
  address: { type: String, required: true },
  note: { type: String },
  prescriptionFile: { type: String }, // optional - url or path
  status: {
  type: String,
  enum: ["pending", "requested", "delivered", "cancelled"],
  default: "pending",
    },
  createdAt: { type: Date, default: Date.now }
});

module.exports = { OrderSchema };


