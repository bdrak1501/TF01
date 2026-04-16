// 🛒 Inicjalizacja koszyka
let cart = JSON.parse(localStorage.getItem("cart")) || [];
const container = document.getElementById("order-products");
let total = 0;

// Funkcja wyświetlająca produkty
function renderCart() {
    if (!container) return;
    container.innerHTML = "";
    total = 0;

    cart.forEach(product => {
        const price = parseInt(product.price.replace(/\D/g, ""));
        total += price;

        container.innerHTML += `
            <div class="cart-product">
                <img src="produkty/${product.image}">
                <div>
                    <strong>${product.name}</strong>
                    <p style="margin:0; font-size:12px; color:#666;">
                        ${product.memory} • ${product.condition}<br>
                        Bateria: ${product.battery || 'N/D'}
                    </p>
                    <p style="margin:5px 0 0 0; font-weight:bold;">${product.price}</p>
                </div>
            </div>
        `;
    });

    document.getElementById("order-total").textContent = `Razem: ${total.toLocaleString("pl-PL")} zł`;
}

// 🚚 Wybór metody dostawy
let selectedMethod = 'inpost';

function selectDelivery(method) {
    selectedMethod = method;

    // Aktualizacja wyglądu przycisków
    document.querySelectorAll('.delivery-card').forEach(card => {
        card.classList.remove('active');
        if (card.innerText.toLowerCase().includes(method.toLowerCase())) {
            card.classList.add('active');
        }
    });

    const infoBox = document.getElementById('delivery-info');
    const addressContainer = document.getElementById('address-container');
    const orderBtn = document.querySelector('.order-btn');

    infoBox.style.display = 'block';
    addressContainer.style.display = 'block';

    if (method === 'odbior') {
        infoBox.innerHTML = "📍 <strong>Odbiór osobisty:</strong> Gliwice, ul. Przykład 12. Płatność na miejscu.";
        addressContainer.style.display = 'none';
        orderBtn.innerText = "Rezerwuję i odbieram";
    } else if (method === 'pobranie') {
        infoBox.innerHTML = "🚚 <strong>Za pobraniem:</strong> Zapłacisz kurierowi przy odbiorze paczki.";
        orderBtn.innerText = "Zamawiam z obowiązkiem zapłaty";
    } else {
        infoBox.innerHTML = "📦 <strong>InPost:</strong> Bezpieczna płatność online przez Stripe.";
        orderBtn.innerText = "Złóż zamówienie i zapłać";
    }
}

// 🚀 GŁÓWNA FUNKCJA - Obsługa Stripe i zamówień manualnych
async function placeOrder() {
    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;
    const phone = document.getElementById("phone").value;
    const address = selectedMethod === 'odbior' ? "Odbiór osobisty" : document.getElementById("address").value;

    if (!name || !email || !phone || (selectedMethod !== 'odbior' && !address)) {
        alert("Proszę uzupełnić wszystkie dane.");
        return;
    }

 // Fragment w checkout.js
const orderData = {
    name,
    email,
    phone,
    address,
    products: cart,
    total: total,
    deliveryMethod: selectedMethod // To musi pasować do req.body na serwerze
};

    try {
        // Jeśli InPost -> idziemy do Stripe
        if (selectedMethod === 'inpost') {
            const res = await fetch("/create-checkout-session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(orderData)
            });
            const data = await res.json();
            
            if (data.url) {
                localStorage.removeItem("cart"); // Czyścimy koszyk przed płatnością
                window.location.href = data.url; // PRZEKIEROWANIE DO STRIPE
            } else {
                alert("Błąd Stripe: " + data.error);
            }
        } 
        // Jeśli Odbiór/Pobranie -> wysyłamy do zwykłej bazy
        else {
            const res = await fetch("/create-manual-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(orderData)
            });

            if (res.ok) {
                localStorage.removeItem("cart");
                window.location.href = "/success.html";
            } else {
                alert("Wystąpił błąd przy składaniu zamówienia.");
            }
        }
    } catch (err) {
        console.error("Błąd:", err);
        alert("Błąd połączenia z serwerem.");
    }
}

// Start
document.addEventListener("DOMContentLoaded", () => {
    renderCart();
    selectDelivery('inpost');
});