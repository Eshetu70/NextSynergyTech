
            let registeredUsers = [];
    
            function openTab(tabName) {
                var i, tabcontent, tabs;
                tabcontent = document.getElementsByClassName("tab-content");
                for (i = 0; i < tabcontent.length; i++) {
                    tabcontent[i].style.display = "none";
                }
                tabs = document.getElementsByClassName("tab");
                for (i = 0; i < tabs.length; i++) {
                    tabs[i].classList.remove("active");
                }
                document.getElementById(tabName).style.display = "block";
            }
    
            function validateLogin(event) {
                event.preventDefault();
                var email = document.getElementById("admin-email").value;
                if (email === "eshetuwek1@gmail.com") {
                    openTab('registrations');
                    displayRegistrations();
                } else {
                    alert("You are not authorized to access this page.");
                }
            }
    
            function submitRegistration(event) {
                event.preventDefault();
                let fullName = document.getElementById("full-name").value;
                let email = document.getElementById("email").value;
                let phone = document.getElementById("phone").value;
                let course = document.getElementById("course").value;
                let date = new Date().toLocaleDateString();
    
                registeredUsers.push({ fullName, email, phone, course, date });
                document.getElementById("success-message").style.display = "block";
            }
    
            function displayRegistrations() {
                let registrationsTable = document.getElementById("registrations-table");
                registrationsTable.innerHTML = "<tr><th>Full Name</th><th>Email</th><th>Phone</th><th>Course</th><th>Date</th></tr>";
                registeredUsers.forEach(user => {
                    let row = `<tr><td>${user.fullName}</td><td>${user.email}</td><td>${user.phone}</td><td>${user.course}</td><td>${user.date}</td></tr>`;
                    registrationsTable.innerHTML += row;
                });
            }
        