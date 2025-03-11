require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());
app.use(cors());

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_API = process.env.PAYPAL_API;

// Генерация токена
async function generateAccessToken() {
    const response = await axios.post(
        `${PAYPAL_API}/v1/oauth2/token`,
        "grant_type=client_credentials&scope=" +
        encodeURIComponent(
            "openid " +
            "address " +
            "email " +
            "phone " +
            "profile " +
            "https://uri.paypal.com/payments/payouts " +
            "https://uri.paypal.com/services/applications/webhooks " +
            "https://uri.paypal.com/services/disputes/read-buyer " +
            "https://uri.paypal.com/services/disputes/read-seller " +
            "https://uri.paypal.com/services/disputes/update-seller " +
            "https://uri.paypal.com/services/expresscheckout " +
            "https://uri.paypal.com/services/identity/activities " +
            "https://uri.paypal.com/services/identity/grantdelegation " +
            "https://uri.paypal.com/services/identity/proxyclient " +
            "https://uri.paypal.com/services/invoicing " +
            "https://uri.paypal.com/services/payments/payment/authcapture " +
            "https://uri.paypal.com/services/payments/realtimepayment " +
            "https://uri.paypal.com/services/payments/refund " +
            "https://uri.paypal.com/services/paypalattributes/business " +
            "https://uri.paypal.com/services/paypalhere " +
            "https://uri.paypal.com/services/subscriptions " +
            "https://uri.paypal.com/services/reporting/search/read " +
            "https://api-m.paypal.com/v1/payments/.* " +
            "https://api-m.paypal.com/v1/vault/credit-card " +
            "https://api-m.paypal.com/v1/vault/credit-card/.* " +
            "https://api.paypal.com/v1/payments/.* " +
            "https://api.paypal.com/v1/payments/refund " +
            "https://api.paypal.com/v1/payments/sale/.*/refund " +
            "https://api.paypal.com/v1/vault/credit-card " +
            "https://api.paypal.com/v1/vault/credit-card/.* " +
            "https://uri.paypal.com/payments/capture " +  // 💥 Добавляем capture
            "https://uri.paypal.com/payments/authorize " + // 💥 Добавляем authorize
            "https://uri.paypal.com/payments/orders " // 💥 Добавляем orders
        ),
        {
            auth: {
                username: PAYPAL_CLIENT_ID,
                password: PAYPAL_SECRET
            },
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        }
    );
    console.log(response.data)
    return response.data.access_token;
}


// Создание заказа и возврат checkout-ссылки
app.get("/create-order", async (req, res) => {
    try {
        const accessToken = await generateAccessToken();
        const response = await axios.post(`${PAYPAL_API}/v2/checkout/orders`, {
            intent: "CAPTURE",
            purchase_units: [{
                amount: { currency_code: "USD", value: "00.01" }
            }],
            application_context: {
                return_url: process.env.SERVER_URL + "/capture-order",
                cancel_url: process.env.SERVER_URL + "/cancel",
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
            }
        }, {
            headers: { "Authorization": `Bearer ${accessToken}`}
        });
        console.log(response.data);

        res.json({ approvalUrl: response.data.links.find(link => link.rel === "approve").href });
    } catch (error) {
        console.error("Ошибка при создании заказа:", error.response?.data || error.message);
        res.status(500).json({ error: "Ошибка при создании платежа" });
    }
});

// Подтверждение платежа
app.get("/capture-order", async (req, res) => {
    try {
        const orderID = req.query.token;
        const accessToken = await generateAccessToken();
        console.log(accessToken)
        const response = await axios.post(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {}, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        console.log(response.data);
        res.status(200).send('OK');
    } catch (error) {
        console.error("Ошибка при подтверждении платежа:", error.response?.data || error.message);
        res.status(500).json({ error: "Ошибка при подтверждении платежа" });
    }
});

app.listen(process.env.PORT || 4000, () => console.log("Сервер запущен на порту 4000"));
