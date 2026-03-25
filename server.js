const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(bodyParser.json());

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
app.get("/orders", (req, res) => {
    res.json(getOrders());
});

/* STATUS */
app.post("/status", (req, res) => {

    const orders = getOrders();

    const order = orders.find(o => o.id == req.body.id);
    if (order) {
        order.status = req.body.status;
    }

    saveOrders(orders);

    res.json({ success: true });
});

/* START */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server działa na porcie " + PORT);
});