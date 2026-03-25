const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(bodyParser.json());

const db = new sqlite3.Database("shop.db");

/* BAZA */
db.run(`
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
`);

/* NOWE ZAMÓWIENIE */
app.post("/order", (req, res) => {

const o = req.body;

db.run(`
INSERT INTO orders
(name,email,phone,address,products,total,status,date)
VALUES (?,?,?,?,?,?,?,?)
`,
[
o.name,
o.email,
o.phone,
o.address,
JSON.stringify(o.products),
o.total,
"Nowe",
new Date().toLocaleString()
],
function(err){

if(err){
return res.status(500).send(err);
}

res.json({success:true,id:this.lastID});

});

});

/* POBIERZ */
app.get("/orders", (req,res)=>{

db.all("SELECT * FROM orders ORDER BY id DESC", (err,rows)=>{
res.json(rows);
});

});

/* STATUS */
app.post("/status", (req,res)=>{

db.run(
"UPDATE orders SET status=? WHERE id=?",
[req.body.status, req.body.id],
()=> res.json({success:true})
);

});

app.listen(3000, ()=>{
console.log("SERVER: http://localhost:3000");
});