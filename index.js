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
    const response = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, 
        "grant_type=client_credentials", {
        auth: {
            username: PAYPAL_CLIENT_ID,
            password: PAYPAL_SECRET
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
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
                return_url: process.env.SERVER_URL + "/success",
                cancel_url: process.env.SERVER_URL + "/cancel",
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
            }
        }, {
            headers: { "Authorization": `Bearer ${accessToken}`}
        });

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
        const response = await axios.post(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {}, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        res.status(200).send('OK');
    } catch (error) {
        console.error("Ошибка при подтверждении платежа:", error.response?.data || error.message);
        res.status(500).json({ error: "Ошибка при подтверждении платежа" });
    }
});

app.listen(process.env.PORT || 4000, () => console.log("Сервер запущен на порту 4000"));
