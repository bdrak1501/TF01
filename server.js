const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(bodyParser.json());

const Database = require("better-sqlite3");
const db = new Database("shop.db");

/* BAZA */
db.prepare(`
CREATE TABLE IF NOT EXISTS orders (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT,
email TEXT,
phone TEXT,
address TEXT,
products TEXT,
total INTEGER,
status TEXT,
date TEXT
)
`).run();

/* NOWE ZAMÓWIENIE */
app.post("/order", (req, res) => {

    const o = req.body;

    const stmt = db.prepare(`
    INSERT INTO orders
    (name,email,phone,address,products,total,status,date)
    VALUES (?,?,?,?,?,?,?,?)
    `);

    const info = stmt.run(
        o.name,
        o.email,
        o.phone,
        o.address,
        JSON.stringify(o.products),
        o.total,
        "Nowe",
        new Date().toLocaleString()
    );

    res.json({ success: true, id: info.lastInsertRowid });
});

/* POBIERZ */
app.get("/orders", (req, res) => {

    const rows = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
    res.json(rows);

});

/* STATUS */
app.post("/status", (req, res) => {

    db.prepare("UPDATE orders SET status=? WHERE id=?")
    .run(req.body.status, req.body.id);

    res.json({ success: true });

});

/* START */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server działa na porcie " + PORT);
});