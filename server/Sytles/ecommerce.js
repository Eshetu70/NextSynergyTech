
let products = [];
let cart = [];

function checkAdmin() {
    let userEmail = prompt("Enter your email:");
    if (userEmail === "eshetuwek1@gmail.com") {
        document.getElementById("admin-section").style.display = "block";
    }
}
checkAdmin();

document.getElementById("upload-form").addEventListener("submit", function(event) {
    event.preventDefault();
    const name = document.getElementById("product-name").value;
    const price = parseFloat(document.getElementById("product-price").value);
    const location = document.getElementById("product-location").value;
    const stock = parseInt(document.getElementById("product-stock").value);
    const image = document.getElementById("product-image").files[0];
    
    if (image) {
        const reader = new FileReader();
        reader.onload = function(event) {
            products.push({ id: products.length + 1, name, price, location, stock, image: event.target.result });
            displayProducts();
        };
        reader.readAsDataURL(image);
    }
});

function displayProducts() {
    const productList = document.getElementById("product-list");
    productList.innerHTML = "";
    products.forEach(product => {
        let productElement = `
            <div class="product">
                <img src="${product.image}" alt="${product.name}" width="100">
                <h3>${product.name}</h3>
                <p>Price: $${product.price.toFixed(2)}</p>
                <p>Location: ${product.location}</p>
                <p>Available: ${product.stock}</p>
                <button onclick="addToCart(${product.id})">Add to Cart</button>
            </div>
        `;
        productList.innerHTML += productElement;
    });
}

function addToCart(productId) {
    let product = products.find(p => p.id === productId);
    if (product && product.stock > 0) {
        cart.push(product);
        product.stock--;
        updateCart();
        displayProducts();
    } else {
        alert("Out of stock!");
    }
}

function updateCart() {
    const cartItems = document.getElementById("cart-items");
    const cartTotal = document.getElementById("cart-total");
    const cartTotalItems = document.getElementById("cart-total-items");
    cartItems.innerHTML = "";
    let total = 0;
    cartTotalItems.textContent = cart.length;
    cart.forEach(item => {
        let li = document.createElement("li");
        li.textContent = `${item.name} - $${item.price.toFixed(2)}`;
        cartItems.appendChild(li);
        total += item.price;
    });
    cartTotal.textContent = `$${total.toFixed(2)}`;
}

function checkout() {
    document.getElementById("checkout").style.display = "block";
    document.getElementById("checkout-total").textContent = document.getElementById("cart-total").textContent;
    document.getElementById("checkout-total-items").textContent = document.getElementById("cart-total-items").textContent;
}

function confirmPurchase() {
    let phone = document.getElementById("phone").value;
    let email = document.getElementById("email").value;
    if (phone && email) {
        alert(`Purchase confirmed! Items will be sent to: ${phone}, Confirmation email: ${email}`);
        cart = [];
        updateCart();
        document.getElementById("checkout").style.display = "none";
    } else {
        alert("Please enter a valid phone number and email.");
    }
}
