require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const qs = require("qs");
const memberstackAdmin = require("@memberstack/admin");
const Paypal = require("./models/Paypal");
const mongoose = require("mongoose");
const Subscription = require("./models/Subscription");

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
    console.log(response.data);

    res.json({
      approvalUrl: response.data.links.find((link) => link.rel === "approve")
        .href,
    });
  } catch (error) {
    console.error(
      "Ошибка при создании заказа:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Ошибка при создании платежа" });
  }
});

// Подтверждение платежа
app.get("/capture-order", async (req, res) => {
  try {
    const orderID = req.query.token;
    const accessToken = await generateAccessToken();
    console.log(accessToken);
    const response = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    console.log(response.data);
    res.status(200).send("OK");
  } catch (error) {
    console.error(
      "Ошибка при подтверждении платежа:",
      error.response?.data || error.message
    );
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
    console.error(
      "Ошибка при создании продукта:",
      error.response?.data || error.message
    );
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
    console.error(
      "Ошибка при создании плана:",
      error.response?.data || error.message
    );
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
    console.log(req.body);

    const accessToken = await generateAccessToken();

    const productResponse = await axios.post(
      `${PAYPAL_API}/v1/catalogs/products`,
      {
        name: product.name,
        description: product.description,
        type: "SERVICE", // "SERVICE" для цифровых товаров, "PHYSICAL" для физических товаров
        category: "SOFTWARE", // Категория товара, можно выбрать из списка PayPal
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const planResponse = await axios.post(
      `${PAYPAL_API}/v1/billing/plans`,
      {
        product_id: productResponse.data.id, // Создай продукт заранее в PayPal
        name: plan.name,
        description: plan.description,
        status: "ACTIVE",
        billing_cycles: [
          {
            frequency: {
              interval_unit: plan.interval ?? "MONTH",
              interval_count: 1,
            },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 12,
            pricing_scheme: {
              fixed_price: { value: String(plan.price), currency_code: "USD" },
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

    const paypal = new Paypal({
      planId: planResponse.data.id,
      productId: productResponse.data.id,
      name: plan.name,
      price: plan.price,
      memberstackPlanId,
    });
    await paypal.save();

    res.json({ plan: paypal });
  } catch (error) {
    console.error(
      "Ошибка при добавлении плана:",
      error.response?.data || error.message
    );
    console.error(error);
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
    console.error(
      "Ошибка при создании подписки:",
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({
        error:
          error.response?.data ||
          error.message ||
          "Ошибка при создании подписки",
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
    console.log(subscriptionData);
    const email = subscriptionData.subscriber.email_address;

    const plan = await Paypal.findOne({
      planId: subscriptionData.plan_id,
    });

    const member = await memberstack.members.addFreePlan({
      id,
      data: {
        id,
        planId: plan.memberstackPlanId,
      },
    });

    const subscription = new Subscription({
      email,
      planId: subscriptionData.plan_id,
      memberstackPlanId: plan.memberstackPlanId,
    });
    await subscription.save();

    console.log("Подписка активирована:", member);
    res.status(200).redirect("https://rfu-news.webflow.io/paypal-test");
  } catch (error) {
    console.error(
      "Ошибка подтверждения подписки:",
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({
        error:
          error.response?.data ||
          error.message ||
          "Ошибка подтверждения подписки",
      });
  }
});

app.get("/plans", async (req, res) => {
  const plans = await Paypal.find();
  res.json({ plans });
});

app.post("/webhook", async (req, res) => {
  const event = req.body;

  console.log("Webhook event:", event);

  if (event.event_type === "BILLING.SUBSCRIPTION.CANCELLED") {
    console.log("Подписка отменена:", event.resource.id);
  } else if (event.event_type === "PAYMENT.SALE.COMPLETED") {
    console.log("Оплата подписки прошла успешно:", event.resource.id);
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/static/index.html");
});

mongoose.connect(process.env.MONGO_URL).then(() => console.log("Connected!"));

app.listen(process.env.PORT || 4000, () =>
  console.log("Сервер запущен на порту 4000")
);
