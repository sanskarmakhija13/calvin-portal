// server/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const authRoutes = require('./routes/auth');
const ccaRoutes = require('./routes/ccas');
const userRoutes = require('./routes/user');
const selectionRoutes = require('./routes/selection');


const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/ccas', ccaRoutes);
app.use('/api/user', userRoutes);
app.use('/api/selection', selectionRoutes);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully! 🍃"))
  .catch(err => console.error(err));

// Test Route
app.get("/api", (req, res) => {
  res.json({ message: "Hello from the Calvin 2.0 backend!" });
});

app.get("/api/db-status", (req, res) => {
  const state = mongoose.connection.readyState;
  let status = "Unknown";
  switch (state) {
    case 0: status = "Disconnected"; break;
    case 1: status = "Connected"; break;
    case 2: status = "Connecting"; break;
    case 3: status = "Disconnecting"; break;
  }
  res.json({ status: status, statusCode: state });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
