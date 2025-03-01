// Function to Submit Registration to MongoDB
async function submitRegistration(event) {
    event.preventDefault();
    let fullName = document.getElementById("full-name").value;
    let email = document.getElementById("email").value;
    let phone = document.getElementById("phone").value;
    let course = document.getElementById("course").value;
    let date = new Date().toLocaleDateString();

    const response = await fetch("http://localhost:5000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, phone, course, date })
    });

    const result = await response.json();
    if (response.ok) {
        document.getElementById("success-message").textContent = result.message;
        document.getElementById("success-message").style.display = "block";
    } else {
        alert("Registration failed.");
    }
}

// Function to Fetch Registrations for Admin
async function displayRegistrations() {
    const email = prompt("Enter admin email:");
    if (email !== "eshetuwek1@gmail.com") {
        alert("You are not authorized to access this page.");
        return;
    }

    const response = await fetch(`http://localhost:5000/registrations?email=${email}`);
    const registrations = await response.json();

    let registrationsTable = document.getElementById("registrations-table");
    registrationsTable.innerHTML = "<tr><th>Full Name</th><th>Email</th><th>Phone</th><th>Course</th><th>Date</th><th>Action</th></tr>";

    registrations.forEach(user => {
        let row = `
            <tr>
                <td>${user.fullName}</td>
                <td>${user.email}</td>
                <td>${user.phone}</td>
                <td>${user.course}</td>
                <td>${user.date}</td>
                <td><button onclick="deleteRegistration('${user._id}')">Delete</button></td>
            </tr>`;
        registrationsTable.innerHTML += row;
    });
}

// Function to Delete a Registration
async function deleteRegistration(id) {
    const email = "eshetuwek1@gmail.com"; // Admin Email
    const response = await fetch(`http://localhost:5000/registrations/${id}?email=${email}`, {
        method: "DELETE"
    });

    if (response.ok) {
        alert("Registration deleted.");
        displayRegistrations();
    } else {
        alert("Failed to delete.");
    }
}
