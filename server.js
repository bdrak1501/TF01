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
   DATABASE CONNECTION (MONGODB)
======================= */
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("Połączono z MongoDB Atlas ✅"))
    .catch(err => console.error("Błąd połączenia z bazą:", err));

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
    date: { type: String, default: () => new Date().toLocaleString() }
});

const Order = mongoose.model("Order", orderSchema);

/* =======================
   CRYPTO HELPERS
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
        const decrypted = Buffer.concat([decipher.update(content), decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        return hash;
    }
}

/* =======================
   EMAIL CONFIGURATION
======================= */
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

async function sendEmail(to, subject, text) {
    try {
        await transporter.sendMail({
            from: `"TeleFix Gliwice" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text
        });
        console.log(`E-mail wysłany do: ${to}`);
    } catch (err) {
        console.error("Błąd wysyłki e-mail:", err);
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
   ROUTES
======================= */

app.post("/login", (req, res) => {
    const { login, password } = req.body;
    if (login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD) {
        return res.json({ success: true, token: password });
    }
    res.status(401).json({ success: false });
});

app.get("/orders", auth, async (req, res) => {
    try {
        const orders = await Order.find().sort({ _id: -1 });
        const decryptedOrders = orders.map(o => ({
            ...o._doc,
            id: o._id,
            email: decrypt(o.email),
            name: decrypt(o.name),
            phone: decrypt(o.phone),
            address: decrypt(o.address)
        }));
        res.json(decryptedOrders);
    } catch (err) {
        res.status(500).json({ error: "Błąd bazy danych" });
    }
});

app.post("/status", auth, async (req, res) => {
    try {
        const { id, status } = req.body;
        const order = await Order.findById(id);
        if (!order) return res.status(404).json({ error: "Nie znaleziono zamówienia" });

        await Order.findByIdAndUpdate(id, { status });
        res.json({ success: true });

        const clientEmail = decrypt(order.email);
        let subject = "";
        let message = "";

        if (status === "Wysłane") {
            subject = "Twoja paczka z TeleFix jest już w drodze! 📦";
            message = `Dobra wiadomość! Twoje zamówienie #${id} zostało wysłane.`;
        } else if (status === "Zakończone") {
            subject = "Zamówienie zrealizowane – dziękujemy!";
            message = `Twoje zamówienie #${id} zostało zakończone. Zapraszamy ponownie!`;
        }

        if (subject && message) {
            sendEmail(clientEmail, subject, message).catch(e => console.log("Błąd maila w tle:", e.message));
        }
    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: "Błąd serwera" });
    }
});

/* =======================
   STRIPE & WEBHOOK
======================= */

app.post("/create-checkout-session", async (req, res) => {
    try {
        const { products, name, phone, address } = req.body; 

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "payment",
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
            cancel_url: "https://telefix.onrender.com/cancel.html",
        });
        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const meta = session.metadata;

        const newOrder = new Order({
            email: encrypt(session.customer_details.email || ""),
            name: encrypt(meta.client_name || session.customer_details.name),
            phone: encrypt(meta.client_phone || ""),
            address: encrypt(meta.client_address || ""), 
            total: session.amount_total / 100,
            products: JSON.parse(meta.cart || "[]"),
            stripe_id: session.id,
            method: "inpost",
            status: "Opłacone"
        });

        await newOrder.save();

        const clientEmail = session.customer_details.email;
        const subject = "Otrzymaliśmy Twoje zamówienie – TeleFix Gliwice";
        const message = `Cześć ${meta.client_name || ''}!\n\nDziękujemy za zakupy. Twoje zamówienie zostało opłacone. Powiadomimy Cię mailowo o wysyłce!`;
        
        sendEmail(clientEmail, subject, message).catch(e => console.log("Błąd maila w webhooku:", e.message));
    }
    res.json({ received: true });
});

app.post("/create-manual-order", async (req, res) => {
    try {
        const { name, email, phone, address, products, total, method } = req.body;

        const newOrder = new Order({
            name: encrypt(name),
            email: encrypt(email),
            phone: encrypt(phone),
            address: encrypt(address),
            total: total,
            products: products,
            method: method || "pobranie/odbiór",
            status: "Nowe (Manualne)"
        });

        await newOrder.save();
        
        sendEmail(email, "Zamówienie przyjęte - TeleFix", `Cześć ${name}, Twoje zamówienie zostało zarejestrowane.`);
        res.json({ success: true });
    } catch (err) {
        console.error("Błąd manualnego zamówienia:", err);
        res.status(500).json({ error: "Błąd zapisu zamówienia" });
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server działa 🚀");
});