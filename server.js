const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const nodemailer = require("nodemailer");

const app = express();

/* =======================
   PERSISTENT STORAGE
======================= */

const FILE = "orders.json";
const TOKENS_FILE = "tokens.json";

if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]");
if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, "[]");

function getOrders() {
    return JSON.parse(fs.readFileSync(FILE));
}

function saveOrders(data) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function getTokens() {
    return JSON.parse(fs.readFileSync(TOKENS_FILE));
}

function saveTokens(data) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
}

/* =======================
   EMAIL
======================= */

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/* =======================
   MIDDLEWARE
======================= */

app.use(cors());

app.use((req, res, next) => {
    if (req.originalUrl === "/webhook") next();
    else bodyParser.json()(req, res, next);
});

app.use(express.static("telefix-gliwice"));

/* =======================
   AUTH
======================= */

function auth(req, res, next) {

    const token = req.headers.authorization;

    if(token !== process.env.ADMIN_PASSWORD){
        return res.status(401).json({ error: "brak dostępu" });
    }

    next();
}

/* =======================
   LOGIN
======================= */

let loginAttempts = {};

app.post("/login", (req, res) => {

    const { login, password } = req.body;

    if(
        login === process.env.ADMIN_LOGIN &&
        password === process.env.ADMIN_PASSWORD
    ){
        return res.json({ success: true, token: password });
    }

    res.status(401).json({ success: false });
});

/* =======================
   ORDERS
======================= */

app.get("/orders", auth, (req, res) => {
    const orders = getOrders().map(o => ({
        ...o,
        email: safedecrypt(o.email),
        name: safedecrypt(o.name),
        address: safeJsonDecrypt(o.address)
    }));

function safeDecrypt(val){
    try{
        return decrypt(val);
    }catch(e){
        return val || "";
    }
}
    
    res.json(orders);
});

app.post("/status", auth, (req, res) => {
    const orders = getOrders();

    const order = orders.find(o => o.id == req.body.id);
    if (order) order.status = req.body.status;

    saveOrders(orders);

    res.json({ success: true });
});

/* =======================
   STRIPE
======================= */

app.post("/create-checkout-session", async (req, res) => {
    const { products } = req.body;

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",

        billing_address_collection: "required",
        phone_number_collection: { enabled: true },

        line_items: products.map(p => ({
            price_data: {
                currency: "pln",
                product_data: { name: p.name },
                unit_amount: parseInt(p.price.replace(/\D/g, "")) * 100
            },
            quantity: 1
        })),

        metadata: {
            cart: JSON.stringify(products)
        },

        success_url: "https://telefix.onrender.com/success.html",
        cancel_url: "https://telefix.onrender.com/cancel.html",
    });

    res.json({ url: session.url });
});

/* =======================
   WEBHOOK
======================= */

app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {

    const sig = req.headers["stripe-signature"];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.log("Webhook error:", err.message);
        return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {

        const session = event.data.object;

        let cart = [];
        try {
            cart = JSON.parse(session.metadata.cart || "[]");
        } catch {}

        const customer = session.customer_details || {};

        const orders = getOrders();

        const newOrder = {
            id: Date.now(),
            email: encrypt(customer.email || ""),
            name: encrypt(customer.name || ""),
            address: encrypt(JSON.stringify(customer.address || {})),
            total: session.amount_total / 100,
            products: cart,
            status: "Opłacone",
            stripe_id: session.id,
            date: new Date().toLocaleString()
        };

        orders.push(newOrder);
        saveOrders(orders);

        try {
            if (customer.email) {
                await transporter.sendMail({
                    from: "TeleFix <twojmail@gmail.com>",
                    to: customer.email,
                    subject: "Zamówienie opłacone ✅",
                    html: `<h2>Dziękujemy za zakup!</h2>`
                });
            }
        } catch (e) {
            console.log("Mail error:", e);
        }

        console.log("✅ NOWE ZAMÓWIENIE");
    }

    res.json({ received: true });
});

/* =======================
   CRYPTO
======================= */

const algorithm = "aes-256-ctr";
const key = Buffer.from(process.env.ENCRYPT_KEY, "hex");

function encrypt(text) {
    if (!text) return "";

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

    return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(hash) {
    try {
        const [ivHex, contentHex] = hash.split(":");

        const iv = Buffer.from(ivHex, "hex");
        const content = Buffer.from(contentHex, "hex");

        const decipher = crypto.createDecipheriv(algorithm, key, iv);

        const decrypted = Buffer.concat([
            decipher.update(content),
            decipher.final()
        ]);

        return decrypted.toString();
    } catch {
        return "";
    }
}

function safeJsonDecrypt(val) {
    try {
        return JSON.parse(decrypt(val));
    } catch {
        return {};
    }
}

/* =======================
   START
======================= */

app.listen(process.env.PORT || 3000, () => {
    console.log("Server działa 🚀");
});