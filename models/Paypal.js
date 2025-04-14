const mongoose = require("mongoose");

const paypalSchema = new mongoose.Schema({
  planId: {
    type: String,
    required: true,
  },
  productId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  memberstackPlanId: {
    type: String,
    required: true,
  },
  salePrice: {
    type: Number,
    required: true,
  },
  interval: {
    type: String,
    required: true,
  },
});

module.exports = mongoose.model("Paypal", paypalSchema);
