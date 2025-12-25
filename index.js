require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const qs = require("qs");
const memberstackAdmin = require("@memberstack/admin");
const Paypal = require("./models/Paypal");
const mongoose = require("mongoose");
const Subscription = require("./models/Subscription");
const logger = require("./config/logger");

require("./cronJobs/removeExpiredSubscriptions");

const app = express();
app.use(express.json());
app.use(cors());

const memberstack = memberstackAdmin.init(process.env.SECRET_KEY);

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API;

const static = express.static(__dirname + "/static");
app.use("/static", static);

const products = {
  [process.env.PRDOUCT_ID]: {
    price: 0.01,
    name: "Test plan",
  },
};

const plans = {
  "P-4WC106554A246992NM7OBV2Q": "pln_insider-monthly-paypal-gw2100nw",
  "P-8N586697TN3124256M7OBYIA": "pln_all-access-paypal-pl1907y9",
  "P-3ML1600338338254EM7OBYYA": "pln_insider-annual-paypal-mb2000l2",
};

const data = qs.stringify({
  grant_type: "client_credentials",
  ignoreCache: "true",
  return_authn_schemes: "true",
  return_client_metadata: "true",
  return_unconsented_scopes: "true",
});

// Генерация токена
async function generateAccessToken() {
  const response = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, data, {
    auth: {
      username: PAYPAL_CLIENT_ID,
      password: PAYPAL_SECRET,
    },
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return response.data.access_token;
}

// Создание заказа и возврат checkout-ссылки
app.get("/create-order", async (req, res) => {
  try {
    const accessToken = await generateAccessToken();
    const response = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "00.01" },
          },
        ],
        application_context: {
          return_url: process.env.SERVER_URL + "/capture-order",
          cancel_url: process.env.SERVER_URL + "/cancel",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    res.json({
      approvalUrl: response.data.links.find((link) => link.rel === "approve")
        .href,
    });
  } catch (error) {
    logger.error('Error creating order', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    res.status(500).json({ error: "Ошибка при создании платежа" });
  }
});

// Подтверждение платежа
app.get("/capture-order", async (req, res) => {
  try {
    const orderID = req.query.token;
    const accessToken = await generateAccessToken();
    logger.info('Capturing order', { orderId: orderID });
    const response = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    logger.info('Order captured successfully', { orderId: orderID, captureData: response.data });
    res.status(200).send("OK");
  } catch (error) {
    logger.error('Error capturing order', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    res.status(500).json({ error: "Ошибка при подтверждении платежа" });
  }
});

app.post("/create-product", async (req, res) => {
  try {
    const accessToken = await generateAccessToken();
    const response = await axios.post(
      `${PAYPAL_API}/v1/catalogs/products`,
      {
        name: "test subscription product",
        description: "test subscription product",
        type: "SERVICE", // "SERVICE" для цифровых товаров, "PHYSICAL" для физических товаров
        category: "SOFTWARE", // Категория товара, можно выбрать из списка PayPal
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    res.json({ productId: response.data.id });
  } catch (error) {
    logger.error('Error creating product', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    res.status(500).json({ error: "Ошибка при создании продукта" });
  }
});

app.post("/create-plan", async (req, res) => {
  try {
    const accessToken = await generateAccessToken();
    const key = Object.keys(products)[0];
    const response = await axios.post(
      `${PAYPAL_API}/v1/billing/plans`,
      {
        product_id: key, // Создай продукт заранее в PayPal
        name: "Test Subscription",
        description: "test subscription product",
        status: "ACTIVE",
        billing_cycles: [
          {
            frequency: { interval_unit: "MONTH", interval_count: 1 },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 12,
            pricing_scheme: {
              fixed_price: {
                value: String(products[key].price),
                currency_code: "USD",
              },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: "CONTINUE",
          payment_failure_threshold: 3,
        },
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    res.json({ planId: response.data.id });
  } catch (error) {
    logger.error('Error creating plan', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    res.status(500).json({ error: "Ошибка при создании плана" });
  }
});

// {
//     plan: {
//         name: string,
//         description: string,
//         price: number,
//         interval: "MONTH" | "DAY" | "WEEK" | "YEAR"
//     },
//     product: {
//         name: string,
//         description: string,
//     },
//     memberstackPlanId: string
// }

app.post("/add-plan", async (req, res) => {
  try {
    const password = req.headers.authorization;
    if (password !== process.env.PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { product, plan, memberstackPlanId } = req.body;
    if (!product || !plan || !memberstackPlanId) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const {
      price,
      name,
      description,
      interval = "MONTH", // "MONTH" или "YEAR"
      trialPrice,
      trialCycles = 1,
    } = plan;

    const accessToken = await generateAccessToken();

    const productResponse = await axios.post(
      `${PAYPAL_API}/v1/catalogs/products`,
      {
        name: product.name,
        description: product.description,
        type: "SERVICE",
        category: "SOFTWARE",
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const billingCycles = [];

    // Если указана скидка на первый период
    if (trialPrice != null) {
      billingCycles.push({
        frequency: {
          interval_unit: interval, // MONTH или YEAR
          interval_count: 1,
        },
        tenure_type: "TRIAL",
        sequence: 1,
        total_cycles: trialCycles,
        pricing_scheme: {
          fixed_price: {
            value: String(trialPrice),
            currency_code: "USD",
          },
        },
      });
    }

    billingCycles.push({
      frequency: {
        interval_unit: interval,
        interval_count: 1,
      },
      tenure_type: "REGULAR",
      sequence: 2,
      total_cycles: 0, // бесконечно
      pricing_scheme: {
        fixed_price: {
          value: String(price),
          currency_code: "USD",
        },
      },
    });

    const planResponse = await axios.post(
      `${PAYPAL_API}/v1/billing/plans`,
      {
        product_id: productResponse.data.id,
        name,
        description,
        status: "ACTIVE",
        billing_cycles: billingCycles,
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: "CONTINUE",
          payment_failure_threshold: 3,
        },
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const paypal = new Paypal({
      planId: planResponse.data.id,
      productId: productResponse.data.id,
      name,
      price,
      memberstackPlanId,
      salePrice: trialPrice,
      interval,
    });
    await paypal.save();

    res.json({ plan: paypal });
  } catch (error) {
    logger.error('Error adding plan', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    res.status(500).json({ error: "Ошибка при добавлении плана" });
  }
});

app.post("/create-subscription", async (req, res) => {
  try {
    const { planId, name, surname, email } = req.body;

    const foundPlan = await Paypal.findOne({ planId });

    if (!foundPlan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const foundSubscription = await Subscription.findOne({
      memberEmail: email,
      planId,
      finished: false,
    });

    if (foundSubscription) {
      return res.status(400).json({ error: "Subscription already exists" });
    }

    const { data } = await axios.get(
      "https://admin.memberstack.com/members/" + email,
      {
        headers: {
          "x-api-key": process.env.SECRET_KEY,
        },
      }
    );
    const user = data.data;

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const accessToken = await generateAccessToken();
    const response = await axios.post(
      `${PAYPAL_API}/v1/billing/subscriptions`,
      {
        plan_id: planId, // Полученный planId из предыдущего запроса
        subscriber: {
          name: { given_name: name, surname },
          email_address: email,
        },
        application_context: {
          return_url:
            process.env.SERVER_URL + "/subscription-success/" + user.id,
          cancel_url: process.env.SERVER_URL + "/subscription-cancel",
        },
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    res.json({
      url: response.data.links.find((link) => link.rel === "approve").href,
    });
  } catch (error) {
    logger.error('Error creating subscription', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    res.status(500).json({
      error:
        error.response?.data || error.message || "Ошибка при создании подписки",
    });
  }
});

app.get("/subscription-success/:id", async (req, res) => {
  try {
    const subscriptionId = req.query.subscription_id;
    const { id } = req.params;
    const accessToken = await generateAccessToken();

    const response = await axios.get(
      `${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const subscriptionData = response.data;
    const email = subscriptionData.subscriber.email_address;

    const plan = await Paypal.findOne({
      planId: subscriptionData.plan_id,
    });

    await memberstack.members.addFreePlan({
      id,
      data: {
        id,
        planId: plan.memberstackPlanId,
      },
    });

    const member = await memberstack.members.retrieve({
      id,
    });

    const subscription = new Subscription({
      email,
      planId: subscriptionData.plan_id,
      memberstackPlanId: plan.memberstackPlanId,
      subscriptionId: subscriptionData.id,
      memberId: id,
      memberEmail: member.data.auth.email,
    });
    await subscription.save();

    res.status(200).redirect("https://www.rfunews.com/");
  } catch (error) {
    logger.error('Error confirming subscription', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    res.status(500).json({
      error:
        error.response?.data ||
        error.message ||
        "Ошибка подтверждения подписки",
    });
  }
});

app.post("/unsubscribe", async (req, res) => {
  const { memberId, subscriptionId } = req.body;

  try {
    let subscription;

    if (subscriptionId) {
      subscription = await Subscription.findOne({ subscriptionId, finished: false });
    } else if (memberId) {
      subscription = await Subscription.findOne({ memberId, finished: false });
    }

    if (!subscription) {
      return res.status(404).json({ error: "Subscrription not found" });
    }

    const accessToken = await generateAccessToken();

    const response = await axios.get(
      `${PAYPAL_API}/v1/billing/subscriptions/${subscription.subscriptionId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    await axios.post(
      `${PAYPAL_API}/v1/billing/subscriptions/${subscription.subscriptionId}/cancel`,
      {
        reason: "User-initiated cancellation",
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    subscription.finished = true;

    if (response.data.billing_info?.next_billing_time) {
      subscription.finishDate = new Date(
        response.data.billing_info.next_billing_time
      );
    }

    await subscription.save();

    res.json({ success: true, message: "Subscription is cancelled" });
  } catch (err) {
    logger.error('Error unsubscribing', {
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

app.get("/plans", async (req, res) => {
  const plans = await Paypal.find();
  res.json({ plans });
});

app.delete("/plan/:id", async (req, res) => {
  try {
    const password = req.headers.authorization;
    if (password !== process.env.PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const plan = await Paypal.findOne({ planId: id });

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const accessToken = await generateAccessToken();

    // Деактивируем план в PayPal
    await axios.post(
      `${PAYPAL_API}/v1/billing/plans/${id}/deactivate`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // Удаляем продукт (не обязательно, но можно)
    await axios.delete(`${PAYPAL_API}/v1/catalogs/products/${plan.productId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // Удаляем локально из Mongo
    await Paypal.deleteOne({ planId: id });

    res.json({ success: true, message: "Plan deleted" });
  } catch (error) {
    logger.error('Error deleting plan', {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    res.status(500).json({ error: "Ошибка при удалении плана" });
  }
});

app.post("/webhook", async (req, res) => {
  const event = req.body;

  logger.info('Webhook received', { eventType: event.event_type, resourceId: event.resource?.id });

  if (event.event_type === "BILLING.SUBSCRIPTION.CANCELLED") {
    logger.info('Subscription cancelled via webhook', { subscriptionId: event.resource.id });
    const subscription = await Subscription.findOne({
      subscriptionId: event.resource.id,
    });

    if (!subscription.finished) {
      subscription.finished = true;
      const accessToken = await generateAccessToken();

      const response = await axios.get(
        `${PAYPAL_API}/v1/billing/subscriptions/${event.resource.id}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (response.data.billing_info.next_billing_time) {
        subscription.finishDate = new Date(
          response.data.billing_info.next_billing_time
        );
      }
      await subscription.save();
    }

  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/static/index.html");
});

mongoose.connect(process.env.MONGO_URL).then(() => console.log('MongoDB connected successfully'));

app.listen(process.env.PORT || 4000, () =>
  console.log(`Server started on port ${process.env.PORT || 4000}`)
);
