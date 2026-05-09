const express = require('express');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;

// Initialize Prisma Client with error handling
let prisma;
try {
    prisma = new PrismaClient();
    console.log('Prisma client initialized successfully');
} catch (error) {
    console.error('Failed to initialize Prisma client:', error);
    process.exit(1);
}

// Initialize database
async function initializeDatabase() {
    try {
        // Test database connection
        await prisma.$connect();
        console.log('Database connected successfully');
        
        // Check if we can perform a simple query
        await prisma.user.count();
        console.log('Database is ready');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

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

// Test database connection
app.get('/api/db-test', async (req, res) => {
    try {
        const userCount = await prisma.user.count();
        res.json({ message: 'Database connected', userCount });
    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// API Routes
app.post('/api/register', async (req, res) => {
    try {
        console.log('Registration request received');
        console.log('Request headers:', req.headers);
        console.log('Request body raw:', req.body);
        console.log('Request body parsed:', JSON.stringify(req.body));
        
        const { name, email, username, password, paypalMe, profilePicture, bio } = req.body;
        
        console.log('Registration data:', { name, email, username, paypalMe, profilePicture, bio });
        
        // Validate required fields
        if (!email || !username || !password || !paypalMe) {
            console.log('Missing required fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        console.log('Checking if user exists...');
        
        // Check if user already exists
        try {
            const existingUser = await prisma.user.findFirst({
                where: {
                    OR: [
                        { email },
                        { username }
                    ]
                }
            });
            
            if (existingUser) {
                console.log('User already exists:', existingUser);
                return res.status(400).json({ error: 'User already exists' });
            }
        } catch (dbError) {
            console.error('Database query error:', dbError);
            return res.status(500).json({ error: 'Database error checking user', details: dbError.message });
        }
        
        console.log('Hashing password...');
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        console.log('Creating user...');
        
        // Create user
        const user = await prisma.user.create({
            data: {
                name: name || username,
                email,
                username,
                password: hashedPassword,
                paypalMe,
                profilePicture: profilePicture || '',
                bio: bio || '',
            },
        });
        
        console.log('User created successfully');
        
        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
        
    } catch (error) {
        console.error('Registration error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Get creator by username
app.get('/api/creator/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        const creator = await prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                name: true,
                username: true,
                paypalMe: true,
                profilePicture: true,
                bio: true,
                createdAt: true
            }
        });
        
        if (!creator) {
            return res.status(404).json({ error: 'Creator not found' });
        }
        
        res.json(creator);
        
    } catch (error) {
        console.error('Get creator error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email }
        });
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Compare passwords
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the main HTML file for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve creator pages (must be last to avoid conflicts)
app.get('/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        const creator = await prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                name: true,
                username: true,
                paypalMe: true,
                profilePicture: true,
                bio: true,
                createdAt: true
            }
        });
        
        if (!creator) {
            return res.status(404).send('Creator not found');
        }
        
        // Serve creator.html with creator data
        res.sendFile(path.join(__dirname, 'creator.html'));
        
    } catch (error) {
        console.error('Creator page error:', error);
        res.status(500).send('Internal server error');
    }
});

// Start server
app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Static files served from: ${__dirname}`);
    
    // Initialize database
    await initializeDatabase();
});
