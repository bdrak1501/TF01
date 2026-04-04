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

// Definicja modelu zamówienia
const orderSchema = new mongoose.Schema({
    email: String,
    name: String,
    address: String,
    total: Number,
    products: Array,
    status: { type: String, default: "Opłacone" },
    stripe_id: String,
    date: { type: String, default: () => new Date().toLocaleString() }
});

const Order = mongoose.model("Order", orderSchema);

/* =======================
   CRYPTO HELPERS
======================= */
const algorithm = "aes-256-ctr";
// Klucz musi mieć 64 znaki hex (32 bajty)
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

function safeJsonDecrypt(val) {
    try {
        const decrypted = decrypt(val);
        return JSON.parse(decrypted);
    } catch {
        return {};
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
            id: o._id, // Mapujemy MongoDB _id na id dla Twojego frontu
            email: decrypt(o.email),
            name: decrypt(o.name),
            address: safeJsonDecrypt(o.address)
        }));
        res.json(decryptedOrders);
    } catch (err) {
        res.status(500).json({ error: "Błąd bazy danych" });
    }
});

app.post("/status", auth, async (req, res) => {
    try {
        const { id, status } = req.body;
        
        // Pobieramy zamówienie, żeby znać e-mail klienta
        const order = await Order.findById(id);
        if (!order) return res.status(404).json({ error: "Nie znaleziono zamówienia" });

        // Aktualizujemy status w bazie
        await Order.findByIdAndUpdate(id, { status });

        // Przygotowanie e-maila
        const clientEmail = decrypt(order.email);
        let subject = "";
        let message = "";

        if (status === "Wysłane") {
            subject = "Twoja paczka z TeleFix jest już w drodze! 📦";
            message = `Dobra wiadomość! Twoje zamówienie o numerze #${id} zostało właśnie wysłane. Spodziewaj się kuriera wkrótce!`;
        } else if (status === "Zakończone") {
            subject = "Zamówienie zrealizowane – dziękujemy!";
            message = `Twoje zamówienie #${id} zostało sfinalizowane. Mamy nadzieję, że sprzęt będzie służył bez zarzutu!`;
        }

        // Wysyłamy e-mail tylko jeśli status to "Wysłane" lub "Zakończone"
        if (subject && message) {
            await sendEmail(clientEmail, subject, message);
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Błąd aktualizacji lub wysyłki e-mail" });
    }
});


/* =======================
   STRIPE & WEBHOOK
======================= */

app.post("/create-checkout-session", async (req, res) => {
    try {
        const { products } = req.body;
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "payment",
            billing_address_collection: "required",
            line_items: products.map(p => ({
                price_data: {
                    currency: "pln",
                    product_data: { name: p.name },
                    unit_amount: parseInt(p.price.replace(/\D/g, "")) * 100
                },
                quantity: 1
            })),
            metadata: { cart: JSON.stringify(products) },
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
        return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const customer = session.customer_details || {};

        const newOrder = new Order({
            email: encrypt(customer.email || ""),
            name: encrypt(customer.name || ""),
            address: encrypt(JSON.stringify(customer.address || {})),
            total: session.amount_total / 100,
            products: JSON.parse(session.metadata.cart || "[]"),
            stripe_id: session.id
        });

        await newOrder.save();
        // Po zapisie w bazie wysyłamy potwierdzenie do klienta
const clientEmail = customer.email;
const subject = "Otrzymaliśmy Twoje zamówienie – TeleFix Gliwice";
const message = `Cześć ${customer.name || ''}!\n\nDziękujemy za zakupy w TeleFix. Twoje zamówienie zostało opłacone i przekazane do realizacji. Powiadomimy Cię, gdy paczka wyruszy w drogę!`;

await sendEmail(clientEmail, subject, message);
    }
    res.json({ received: true });
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server działa 🚀");
});

/* =======================
   EMAIL CONFIGURATION
======================= */
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // Twój adres Gmail
        pass: process.env.EMAIL_PASS  // Hasło aplikacji Gmail (16 znaków)
    }
});

// Funkcja pomocnicza do wysyłki
async function sendEmail(to, subject, text) {
    try {
        await transporter.sendMail({
            from: `"TeleFix Gliwice" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text
        });
        console.log(`E-mail wysłany do: ${to} [${subject}]`);
    } catch (err) {
        console.error("Błąd wysyłki e-mail:", err);
    }
}