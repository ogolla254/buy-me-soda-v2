const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url} - ${new Date().toISOString()}`);
    next();
});

app.use(express.static('.')); // Serve static files from current directory

// Simple test endpoint
app.get('/api/test', (req, res) => {
    console.log('Test endpoint called');
    res.json({ message: 'Server is working!' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
    console.log('📁 Serving static files from current directory');
    console.log('🎉 All pages are ready to access!');
});
