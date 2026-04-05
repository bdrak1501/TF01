// 🛒 Inicjalizacja koszyka i elementów DOM
let cart = JSON.parse(localStorage.getItem("cart")) || [];
const container = document.getElementById("order-products");
let total = 0;

// Funkcja renderująca produkty w podsumowaniu
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

// 🚚 Logika wyboru metody dostawy
let selectedMethod = 'inpost';

function selectDelivery(method) {
    selectedMethod = method;

    // Aktualizacja wizualna kafelków wyboru
    document.querySelectorAll('.delivery-card').forEach(card => {
        card.classList.remove('active');
        if (card.innerText.toLowerCase().includes(method.toLowerCase())) {
            card.classList.add('active');
        }
    });

    const infoBox = document.getElementById('delivery-info');
    const addressContainer = document.getElementById('address-container');
    const orderBtn = document.querySelector('.order-btn');

    // Domyślne ustawienia widoku
    infoBox.style.display = 'block';
    addressContainer.style.display = 'block';
    orderBtn.innerText = "Złóż zamówienie i zapłać";

    // Dopasowanie interfejsu do wybranej metody
    if (method === 'odbior') {
        infoBox.innerHTML = "📍 <strong>Odbiór osobisty:</strong> Gliwice, ul. Przykład 12. Płatność gotówką lub kartą na miejscu.";
        addressContainer.style.display = 'none';
        orderBtn.innerText = "Rezerwuję i odbieram";
    } else if (method === 'pobranie') {
        infoBox.innerHTML = "🚚 <strong>Za pobraniem:</strong> Zapłacisz kurierowi przy odbiorze. Koszt dostawy zostanie doliczony.";
        orderBtn.innerText = "Zamawiam z obowiązkiem zapłaty";
    } else {
        infoBox.innerHTML = "📦 <strong>InPost:</strong> Bezpieczna płatność online. Podaj adres domowy lub kod Paczkomatu.";
        orderBtn.innerText = "Złóż zamówienie i zapłać";
    }
}

// 🚀 Funkcja finalizująca zamówienie
async function placeOrder() {
    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;
    const phone = document.getElementById("phone").value;
    const address = selectedMethod === 'odbior' ? "Odbiór osobisty" : document.getElementById("address").value;

    // Walidacja pól
    if (!name || !email || !phone || (selectedMethod !== 'odbior' && !address)) {
        alert("Proszę uzupełnić wszystkie dane.");
        return;
    }

    if (cart.length === 0) {
        alert("Koszyk jest pusty.");
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
        // Wybór punktu końcowego API w zależności od metody
        const endpoint = (selectedMethod === 'inpost') ? "/create-checkout-session" : "/create-manual-order";

        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (selectedMethod === 'inpost' && data.url) {
            // Przekierowanie do bramki Stripe
            window.location.href = data.url;
        } else if (res.ok) {
            // Sukces dla metod manualnych (Odbiór/Pobranie)
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

// Inicjalizacja skryptu po załadowaniu strony
document.addEventListener("DOMContentLoaded", () => {
    renderCart();
    // Domyślnie ustawiamy InPost, jeśli element istnieje
    if (document.querySelector('.delivery-card')) {
        selectDelivery('inpost');
    }
});