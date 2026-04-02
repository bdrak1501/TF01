const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

let loginAttempts = {};




const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.use(cors());
app.use((req, res, next) => {
    if (req.originalUrl === "/webhook") {
        next();
    } else {
        bodyParser.json()(req, res, next);
    }
});

app.use(express.static("telefix-gliwice"));

const FILE = "orders.json";

/* jeśli nie ma pliku → utwórz */
if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, "[]");
}

/* pomocnicze */
function getOrders() {
    return JSON.parse(fs.readFileSync(FILE));
}

function saveOrders(data) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/* NOWE ZAMÓWIENIE */
app.post("/order", (req, res) => {

    const orders = getOrders();
    const o = req.body;

    const newOrder = {
        id: Date.now(),
        ...o,
        status: "Nowe",
        date: new Date().toLocaleString()
    };

    orders.push(newOrder);
    saveOrders(orders);

    res.json({ success: true, id: newOrder.id });
});

/* POBIERZ */
app.get("/orders", auth, (req, res) => {

    const orders = getOrders().map(o => ({
        ...o,
        email: safeDecrypt(o.email),
        name: safeDecrypt(o.name),
        address: (() => {
    try{
        return JSON.parse(decrypt(o.address));
    }catch{
        return {};
    }
})()
    }));

    res.json(orders);
});

/* STATUS */
app.post("/status", auth, (req, res) => {

    const orders = getOrders();

    const order = orders.find(o => o.id == req.body.id);
    if (order) {
        order.status = req.body.status;
    }

    saveOrders(orders);

    res.json({ success: true });
});

app.post("/create-checkout-session", async (req, res) => {

    const { products, total } = req.body;

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],

        line_items: products.map(p => ({
            price_data: {
                currency: "pln",
                product_data: {
                    name: p.name,
                },
                unit_amount: parseInt(p.price.replace(/\D/g,"")) * 100,
            },
            quantity: 1,
        })),

metadata: {
    cart: JSON.stringify(products)
},

mode: "payment",

        success_url: "https://telefix.onrender.com/success.html",
        cancel_url: "https://telefix.onrender.com/cancel.html",
    });

    res.json({ url: session.url });
});

app.post("/webhook", express.raw({type: 'application/json'}), async (req, res) => {

    const sig = req.headers['stripe-signature'];

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
    try{
        cart = JSON.parse(session.metadata.cart || "[]");
    }catch(e){
        console.log("Cart parse error");
    }

    const orders = getOrders();

    const newOrder = {
    id: Date.now(),
    email: encrypt(session.customer_details.email || ""),
    name: encrypt(session.customer_details.name || ""),
    address: encrypt(JSON.stringify(session.customer_details.address || {})),
    total: session.amount_total / 100,
    products: cart,
    status: "Opłacone",
    payment_status: session.payment_status,
    stripe_id: session.id,
    date: new Date().toLocaleString()
};

    orders.push(newOrder);
    saveOrders(orders);

    try {
        await transporter.sendMail({
            from: "TeleFix <twojmail@gmail.com>",
            to: session.customer_details?.email,
            subject: "Zamówienie opłacone ✅",
            html: `
                <h2>Dziękujemy za zakup!</h2>
                <p>Kwota: ${session.amount_total / 100} zł</p>
                <p>ID zamówienia: ${session.id}</p>
            `
        });
    } catch(e){
        console.log("Mail error:", e);
    }

    console.log("✅ NOWE OPŁACONE ZAMÓWIENIE");
}

    res.json({ received: true });
});

/* START */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server działa na porcie " + PORT);
});

const crypto = require("crypto");

let ADMIN_TOKENS = [];

app.post("/login", (req, res) => {

    const { login, password } = req.body;
    const ip = req.ip;

    if(loginAttempts[ip] > 10){
        return res.status(429).json({error:"Za dużo prób"});
    }

    if(
        login === process.env.ADMIN_LOGIN &&
        password === process.env.ADMIN_PASSWORD
    ){
        loginAttempts[ip] = 0;

        const token = crypto.randomBytes(48).toString("hex");
        ADMIN_TOKENS.push(token);

        res.json({ success: true, token });
    } else {
        loginAttempts[ip] = (loginAttempts[ip] || 0) + 1;

        res.status(401).json({ success: false });
    }

});

function auth(req,res,next){

    const token = req.headers.authorization;

  if(!token || !ADMIN_TOKENS.includes(token)){
    return res.status(401).json({error:"brak dostępu"});
}

    next();
}

const algorithm = "aes-256-ctr";
const key = Buffer.from(process.env.ENCRYPT_KEY);

function encrypt(text){
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(text),
        cipher.final()
    ]);

    return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(hash){
    const [ivHex, contentHex] = hash.split(":");

    const iv = Buffer.from(ivHex, "hex");
    const content = Buffer.from(contentHex, "hex");

    const decipher = crypto.createDecipheriv(algorithm, key, iv);

    const decrypted = Buffer.concat([
        decipher.update(content),
        decipher.final()
    ]);

    return decrypted.toString();
}


function safeDecrypt(val){
    try{
        return decrypt(val);
    }catch(e){
        return "";
    }
}