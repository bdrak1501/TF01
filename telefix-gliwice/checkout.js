let cart =
JSON.parse(localStorage.getItem("cart")) || [];

const container =
document.getElementById("order-products");

let total = 0;

cart.forEach(product=>{

const price =
parseInt(product.price.replace(/\D/g,""));

total += price;

container.innerHTML += `

<div class="cart-product">

<img src="produkty/${product.image}">

<div>

<strong>${product.name}</strong>

<p>
${product.memory} •
${product.condition}<br>
Bateria ${product.battery}
</p>

<p>${product.price}</p>

</div>

</div>

`;

});

document.getElementById("order-total")
.textContent =
"Razem: " + total.toLocaleString("pl-PL")+" zł";


async function placeOrder(){

const order = {

name: document.getElementById("name").value,
email: document.getElementById("email").value,
phone: document.getElementById("phone").value,
address: document.getElementById("address").value,

products: cart,
total: total

};

await fetch("/orders", {

method:"POST",
headers:{
"Content-Type":"application/json"
},
body: JSON.stringify(order)

});

localStorage.removeItem("cart");

window.location.href="thankyou.html";

}