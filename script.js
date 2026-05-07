// User session management
class UserSession {
    static isLoggedIn() {
        return localStorage.getItem('user') !== null;
    }

    static getCurrentUser() {
        const userData = localStorage.getItem('user');
        return userData ? JSON.parse(userData) : null;
    }

    static setUser(user) {
        localStorage.setItem('user', JSON.stringify(user));
    }

    static logout() {
        localStorage.removeItem('user');
    }
}

// API functions
class API {
    static getBaseUrl() {
        const isProduction = window.location.hostname !== 'localhost';
        return isProduction 
            ? 'https://buy-me-soda-v2-production.up.railway.app'
            : 'http://localhost:3001';
    }

    static async register(userData) {
        try {
            const response = await fetch(`${API.getBaseUrl()}/api/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData),
            });
            
            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            throw new Error('Registration failed');
        }
    }

    static async login(credentials) {
        try {
            const response = await fetch(`${API.getBaseUrl()}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(credentials),
            });
            
            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    static async getCreator(username) {
        try {
            const response = await fetch(`${API.getBaseUrl()}/api/creator/${username}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            
            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Creator not found');
            }
        } catch (error) {
            console.error('Get creator error:', error);
            throw error;
        }
    }
}

// Form validation
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validatePaypalMe(url) {
    // Must start with https://paypal.me/
    return url.startsWith('https://paypal.me/');
}

// Show message
function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        max-width: 300px;
        background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
    `;
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

// Initialize main page
function initializeMainPage() {
    const loggedOutView = document.getElementById('loggedOutView');
    const loggedInView = document.getElementById('loggedInView');
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (UserSession.isLoggedIn()) {
        const user = UserSession.getCurrentUser();
        document.getElementById('username').textContent = user.username;
        document.getElementById('paypalMe').textContent = user.paypalMe;
        loggedOutView.style.display = 'none';
        loggedInView.style.display = 'flex';
    } else {
        loggedOutView.style.display = 'flex';
        loggedInView.style.display = 'none';
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            UserSession.logout();
            location.reload();
        });
    }
}

// Initialize signup page
function initializeSignupPage() {
    const form = document.getElementById('signupForm');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(form);
        const userData = {
            name: formData.get('name'),
            email: formData.get('email'),
            username: formData.get('username'),
            password: formData.get('password'),
            paypalMe: formData.get('paypalMe'),
            bio: formData.get('bio') || '',
            profilePicture: '' // TODO: Handle file upload later
        };
        
        console.log('Sending registration data:', userData);
        
        // Validation
        if (!userData.name || userData.name.length < 2) {
            showMessage('Please enter your name', 'error');
            return;
        }
        
        if (!validateEmail(userData.email)) {
            showMessage('Please enter a valid email', 'error');
            return;
        }
        
        if (userData.username.length < 3) {
            showMessage('Username must be at least 3 characters', 'error');
            return;
        }
        
        if (userData.password.length < 6) {
            showMessage('Password must be at least 6 characters', 'error');
            return;
        }
        
        if (!validatePaypalMe(userData.paypalMe)) {
            showMessage('Please enter a valid PayPal.Me link', 'error');
            return;
        }
        
        try {
            await API.register(userData);
            showMessage('Account created successfully!', 'success');
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 1500);
        } catch (error) {
            showMessage('Error creating account', 'error');
        }
    });
}

// Initialize login page
function initializeLoginPage() {
    const form = document.getElementById('loginForm');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(form);
        const credentials = {
            email: formData.get('email'),
            password: formData.get('password')
        };
        
        // Validation
        if (!validateEmail(credentials.email)) {
            showMessage('Please enter a valid email', 'error');
            return;
        }
        
        if (!credentials.password) {
            showMessage('Please enter your password', 'error');
            return;
        }
        
        try {
            const user = await API.login(credentials);
            UserSession.setUser(user);
            showMessage(`Welcome back, ${user.name || user.username}!`, 'success');
            setTimeout(() => {
                window.location.href = `/${user.username}`;
            }, 1500);
        } catch (error) {
            showMessage('Invalid email or password', 'error');
        }
    });
}

// Initialize QR page
function initializeQRPage() {
    // Check if user is logged in
    if (!UserSession.isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }
    
    const user = UserSession.getCurrentUser();
    const paypalMeSpan = document.getElementById('paypalMe');
    const downloadBtn = document.getElementById('downloadBtn');
    
    if (paypalMeSpan) {
        paypalMeSpan.textContent = user.paypalMe;
    }
    
    // Generate QR code
    setTimeout(() => {
        const qrContainer = document.getElementById('qrcode');
        if (qrContainer) {
            qrContainer.innerHTML = '';
            new QRCode(qrContainer, {
                text: user.paypalMe,
                width: 256,
                height: 256,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        }
    }, 100);
    
    // Download functionality
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const canvas = document.querySelector('#qrcode canvas');
            if (canvas) {
                const link = document.createElement('a');
                link.download = `${user.username}-soda-qr.png`;
                link.href = canvas.toDataURL();
                link.click();
            }
        });
    }
}

// Initialize creator page
function initializeCreatorPage() {
    // Get username from URL
    const pathParts = window.location.pathname.split('/');
    const username = pathParts[pathParts.length - 1];
    
    if (!username || username === '') {
        window.location.href = 'index.html';
        return;
    }
    
    // Use dynamic API URL for both local and production
    const isProduction = window.location.hostname !== 'localhost';
    const apiBaseUrl = isProduction 
        ? 'https://buy-me-soda-v2-production.up.railway.app'
        : 'http://localhost:3001';
    
    // Fetch creator data
    fetch(`${API.getBaseUrl()}/api/creator/${username}`)
        .then(response => response.json())
        .then(creator => {
        // Update page content
        document.title = `${creator.name || creator.username} - Buy Me a Soda 🥤`;
        document.getElementById('creatorName').textContent = creator.name || creator.username;
        document.getElementById('creatorBio').textContent = creator.bio || 'Support me by buying me a soda! 🥤';
        
        // Update profile image
        const profileImg = document.getElementById('profileImage');
        if (creator.profilePicture && creator.profilePicture !== '') {
            profileImg.src = creator.profilePicture;
        }
        
        // Generate QR code for creator page
        setTimeout(() => {
            const qrContainer = document.getElementById('qrcode');
            if (qrContainer) {
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, {
                    text: `${window.location.origin}/${creator.username}`,
                    width: 200,
                    height: 200,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
            }
        }, 100);
        
        // Add click handlers for soda buttons
        const sodaButtons = document.querySelectorAll('.soda-btn');
        sodaButtons.forEach(button => {
            button.addEventListener('click', () => {
                const sodas = button.dataset.sodas;
                const paypalUrl = `${creator.paypalMe}/${sodas}`;
                window.open(paypalUrl, '_blank');
                
                // Show thank you message after a delay
                setTimeout(() => {
                    window.open(`thank-you.html?creator=${encodeURIComponent(creator.name || creator.username)}`, '_blank');
                }, 2000);
            });
        });
        
        // Copy link functionality
        const copyBtn = document.getElementById('copyLinkBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const url = `${window.location.origin}/${creator.username}`;
                navigator.clipboard.writeText(url).then(() => {
                    showMessage('Link copied to clipboard!', 'success');
                });
            });
        }
        
        // Share QR functionality
        const shareQRBtn = document.getElementById('shareQRBtn');
        if (shareQRBtn) {
            shareQRBtn.addEventListener('click', () => {
                const qrCanvas = document.querySelector('#qrcode canvas');
                if (qrCanvas) {
                    qrCanvas.toBlob(blob => {
                        const file = new File([blob], 'qr-code.png', { type: 'image/png' });
                        if (navigator.share && navigator.canShare({ files: [file] })) {
                            navigator.share({
                                title: `Support ${creator.name || creator.username}`,
                                text: `Buy me a soda! 🥤`,
                                files: [file]
                            });
                        } else {
                            // Fallback: download the QR code
                            const link = document.createElement('a');
                            link.download = `${creator.username}-qr.png`;
                            link.href = qrCanvas.toDataURL();
                            link.click();
                        }
                    });
                }
            });
        }
        
    }).catch(error => {
        showMessage('Creator not found', 'error');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 2000);
    });
}

// Page initialization
document.addEventListener('DOMContentLoaded', () => {
    const currentPath = window.location.pathname;
    const pageName = currentPath.split('/').pop() || 'index.html';
    
    // Check if this is a creator page (no .html extension)
    if (!pageName.includes('.html') && pageName !== '') {
        initializeCreatorPage();
        return;
    }
    
    switch(pageName) {
        case 'index.html':
        case '':
            initializeMainPage();
            break;
        case 'signup.html':
            initializeSignupPage();
            break;
        case 'login.html':
            initializeLoginPage();
            break;
    }
});
