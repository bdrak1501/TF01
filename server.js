const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

/* =======================
   DATABASE
======================= */
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("Połączono z MongoDB Atlas ✅"))
    .catch(err => console.error("Błąd połączenia:", err));

/* =======================
   SCHEMAS
======================= */

// 🛒 ZAMÓWIENIA (SKLEP)
const orderSchema = new mongoose.Schema({
    email: String,
    name: String,
    phone: String,
    address: String,
    total: Number,
    products: Array,
    method: String,
    status: { type: String, default: "Nowe" },
    stripe_id: String,
    source: { type: String, default: "sklep" },
    date: { type: String, default: () => new Date().toLocaleString() }
});

const Order = mongoose.model("Order", orderSchema);

// 💰 WYCENY (NOWE)
const quoteSchema = new mongoose.Schema({
    name: String,
    phone: String,
    instagram: String,
    location: String,
    notes: String,

    device: {
        series: String,
        model: String,
        memory: String,
        battery: String,
        visual: String,
        damage: String,
        back: String,
        faceid: String,
        components: String,
        extra: String
    },

    price: Number,
    type: String, // dojazd / wysyłka
    status: { type: String, default: "Nowe" },
    source: { type: String, default: "wycena" },
    date: { type: String, default: () => new Date().toLocaleString() }
});

const Quote = mongoose.model("Quote", quoteSchema);

/* =======================
   CRYPTO
======================= */
const algorithm = "aes-256-ctr";
const key = Buffer.from(process.env.ENCRYPT_KEY || "0".repeat(64), "hex");

function encrypt(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(hash) {
    try {
        if (!hash || !hash.includes(":")) return hash;
        const [ivHex, contentHex] = hash.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const content = Buffer.from(contentHex, "hex");
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        return Buffer.concat([decipher.update(content), decipher.final()]).toString();
    } catch {
        return hash;
    }
}

/* =======================
   EMAIL
======================= */
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: { rejectUnauthorized: false }
});

async function sendEmail(to, subject, text) {
    try {
        await transporter.sendMail({
            from: `"TeleFix Gliwice" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text
        });
    } catch (err) {
        console.error("Mail error:", err.message);
    }
}

/* =======================
   MIDDLEWARE
======================= */
app.use(cors());
app.use((req, res, next) => {
    if (req.originalUrl === "/webhook") next();
    else bodyParser.json()(req, res, next);
});
app.use(express.static("telefix-gliwice"));

function auth(req, res, next) {
    if (req.headers.authorization !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: "brak dostępu" });
    }
    next();
}

/* =======================
   AUTH
======================= */
app.post("/login", (req, res) => {
    const { login, password } = req.body;
    if (login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD) {
        return res.json({ success: true, token: password });
    }
    res.status(401).json({ success: false });
});

/* =======================
   ORDERS (SKLEP)
======================= */
app.get("/orders", auth, async (req, res) => {
    const orders = await Order.find().sort({ _id: -1 });

    res.json(orders.map(o => ({
        ...o._doc,
        id: o._id,
        email: decrypt(o.email),
        name: decrypt(o.name),
        phone: decrypt(o.phone),
        address: decrypt(o.address)
    })));
});

/* =======================
   QUOTES (WYCENY)
======================= */
app.get("/quotes", auth, async (req, res) => {
    const quotes = await Quote.find().sort({ _id: -1 });

    res.json(quotes.map(q => ({
        ...q._doc,
        name: decrypt(q.name),
        phone: decrypt(q.phone),
        instagram: decrypt(q.instagram),
        location: decrypt(q.location),
        notes: decrypt(q.notes)
    })));
});

/* =======================
   CREATE QUOTE 🔥
======================= */
app.post("/create-quote", async (req, res) => {
    try {
        const d = req.body;

        const quote = new Quote({
            name: encrypt(d.name),
            phone: encrypt(d.phone),
            instagram: encrypt(d.instagram),
            location: encrypt(d.location),
            notes: encrypt(d.notes),

            device: d.device,
            price: d.price,
            type: d.type
        });

        await quote.save();

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Błąd zapisu wyceny" });
    }
});

/* =======================
   STATUS
======================= */
app.post("/status", auth, async (req, res) => {
    const { id, status } = req.body;

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: "Nie znaleziono" });

    await Order.findByIdAndUpdate(id, { status });

    const email = decrypt(order.email);

    if (status === "Wysłane") {
        sendEmail(email, "Paczka w drodze", `Zamówienie #${id} wysłane`);
    }

    res.json({ success: true });
});

/* =======================
   STRIPE
======================= */
app.post("/create-checkout-session", async (req, res) => {
    const { products, name, phone, address, email } = req.body;

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: email,
        line_items: products.map(p => ({
            price_data: {
                currency: "pln",
                product_data: { name: p.name },
                unit_amount: parseInt(p.price.replace(/\D/g, "")) * 100
            },
            quantity: 1
        })),
        metadata: {
            cart: JSON.stringify(products),
            client_name: name,
            client_phone: phone,
            client_address: address
        },
        success_url: "https://telefix.onrender.com/success.html",
        cancel_url: "https://telefix.onrender.com/cancel.html"
    });

    res.json({ url: session.url });
});

app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];

    const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const meta = session.metadata;

        await new Order({
            email: encrypt(session.customer_details.email),
            name: encrypt(meta.client_name),
            phone: encrypt(meta.client_phone),
            address: encrypt(meta.client_address),
            total: session.amount_total / 100,
            products: JSON.parse(meta.cart),
            stripe_id: session.id,
            method: "Stripe",
            status: "Opłacone"
        }).save();
    }

    res.json({ received: true });
});

/* ======================= */
app.listen(process.env.PORT || 3000, () => {
    console.log("Server działa 🚀");
});