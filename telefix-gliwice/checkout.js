// 🛒 Ładowanie koszyka z localStorage
let cart = JSON.parse(localStorage.getItem("cart")) || [];
const container = document.getElementById("order-products");
let total = 0;

// Renderowanie produktów w podsumowaniu
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

// 🚚 Logika wyboru dostawy
let selectedMethod = 'inpost';

function selectDelivery(method) {
    selectedMethod = method;

    // Aktualizacja wyglądu kafelków
    document.querySelectorAll('.delivery-card').forEach(card => {
        card.classList.remove('active');
        // Sprawdzamy czy tekst kafelka zawiera nazwę metody (uproszczone)
        if (card.innerText.toLowerCase().includes(method.toLowerCase()) || 
            (method === 'inpost' && card.innerText.includes('InPost'))) {
            card.classList.add('active');
        }
    });

    const infoBox = document.getElementById('delivery-info');
    const addressContainer = document.getElementById('address-container');
    const orderBtn = document.querySelector('.order-btn');

    // Reset domyślny
    infoBox.style.display = 'block';
    addressContainer.style.display = 'block';
    orderBtn.innerText = "Złóż zamówienie i zapłać";

    if (method === 'odbior') {
        infoBox.innerHTML = "📍 <strong>Odbiór osobisty:</strong> Gliwice, ul. Przykład 12. Płatność gotówką lub kartą przy odbiorze. Zapraszamy po otrzymaniu potwierdzenia.";
        addressContainer.style.display = 'none';
        orderBtn.innerText = "Rezerwuję i odbieram";
    } else if (method === 'pobranie') {
        infoBox.innerHTML = "🚚 <strong>Wysyłka za pobraniem:</strong> Zapłacisz kurierowi przy odbiorze paczki. Koszt dostawy (+15 zł) doliczony do kwoty.";
        orderBtn.innerText = "Zamawiam z obowiązkiem zapłaty";
    } else {
        infoBox.innerHTML = "📦 <strong>Paczkomat / Kurier:</strong> Bezpieczna płatność online przez Stripe. Podaj adres lub kod paczkomatu.";
        orderBtn.innerText = "Złóż zamówienie i zapłać";
    }
}

// 🚀 Finalizacja zamówienia
async function placeOrder() {
    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;
    const phone = document.getElementById("phone").value;
    const address = selectedMethod === 'odbior' ? "Odbiór osobisty" : document.getElementById("address").value;

    // Walidacja
    if (!name || !email || !phone || (selectedMethod !== 'odbior' && !address)) {
        alert("Proszę wypełnić wszystkie pola formularza.");
        return;
    }

    if (cart.length === 0) {
        alert("Twój koszyk jest pusty.");
        return;
    }

    const orderData = {
        name,
        email,
        phone,
        address,
        products: cart,
        total: total,
        deliveryMethod: selectedMethod
    };

    try {
        // Wybór bramki: Stripe dla InPost, manualny zapis dla reszty
        const endpoint = (selectedMethod === 'inpost') ? "/create-checkout-session" : "/create-manual-order";

        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (selectedMethod === 'inpost' && data.url) {
            // Przekierowanie do płatności Stripe
            window.location.href = data.url;
        } else if (res.ok) {
            // Sukces dla odbioru/pobrania
            localStorage.removeItem("cart");
            window.location.href = "/success.html";
        } else {
            alert("Błąd: " + (data.error || "Nie udało się złożyć zamówienia."));
        }
    } catch (err) {
        console.error("Order Error:", err);
        alert("Błąd połączenia z serwerem.");
    }
}

// Inicjalizacja przy starcie
document.addEventListener("DOMContentLoaded", () => {
    renderCart();
    selectDelivery('inpost');
});