const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB Connection
const mongoURI = 'mongodb+srv://eshetu:Mygrace%40%4007!@cluster0.qli7n5o.mongodb.net/nbda-project4?retryWrites=true&w=majority';
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

// Schema for Registrations
const RegistrationSchema = new mongoose.Schema({
    fullName: String,
    email: String,
    phone: String,
    course: String,
    date: String
});

const Registration = mongoose.model('Registration', RegistrationSchema);

// API to Save Registration
app.post('/register', async (req, res) => {
    const { fullName, email, phone, course, date } = req.body;
    try {
        const newRegistration = new Registration({ fullName, email, phone, course, date });
        await newRegistration.save();
        res.json({ message: "Successfully registered!" });
    } catch (error) {
        res.status(500).json({ error: "Failed to register" });
    }
});

// API to Get Registrations (Admin Only)
app.get('/registrations', async (req, res) => {
    const adminEmail = req.query.email;
    if (adminEmail !== "eshetuwek1@gmail.com") {
        return res.status(403).json({ error: "Unauthorized access" });
    }
    const registrations = await Registration.find();
    res.json(registrations);
});

// API to Delete a Registration (Admin Only)
app.delete('/registrations/:id', async (req, res) => {
    const adminEmail = req.query.email;
    if (adminEmail !== "eshetuwek1@gmail.com") {
        return res.status(403).json({ error: "Unauthorized access" });
    }
    await Registration.findByIdAndDelete(req.params.id);
    res.json({ message: "Registration deleted" });
});

// Start the server
app.listen(5000, () => {
    console.log("Server running on port 5000");
});
