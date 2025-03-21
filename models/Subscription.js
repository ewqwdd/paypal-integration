const { default: mongoose, Schema } = require("mongoose");

const subscriptionSchema = new Schema({
  email: {
    type: String,
    required: true,
  },
  planId: {
    type: String,
    required: true,
  },
  subscriptionId: {
    type: String,
    required: true,
  },
  memberstackPlanId: {
    type: String,
    required: true,
  },
  memberId: {
    type: String,
    required: true,
  },
  memberEmail: {
    type: String,
    required: true,
  },
});

module.exports = mongoose.model("Subscription", subscriptionSchema);
