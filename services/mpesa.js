const MPESA_ENV = process.env.MPESA_ENV || 'sandbox';
const BASE_URL = MPESA_ENV === 'production'
  ? (process.env.MPESA_BASE_URL || 'https://api.safaricom.co.ke')
  : (process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function timestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizePhone(phone) {
  const raw = String(phone || '').replace(/\s+/g, '');
  if (/^254[17]\d{8}$/.test(raw)) return raw;
  if (/^0[17]\d{8}$/.test(raw)) return `254${raw.slice(1)}`;
  if (/^\+254[17]\d{8}$/.test(raw)) return raw.slice(1);
  throw new Error('Use a valid Kenyan M-Pesa phone number');
}

async function getAccessToken() {
  const basic = Buffer.from(`${required('MPESA_CONSUMER_KEY')}:${required('MPESA_CONSUMER_SECRET')}`).toString('base64');
  const response = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.errorMessage || 'Could not get M-Pesa access token');
  return data.access_token;
}

async function startStkPush({ amount, phone, reference, description }) {
  const shortcode = required('MPESA_SHORTCODE');
  const passkey = required('MPESA_PASSKEY');
  const callbackUrl = required('MPESA_CALLBACK_URL');
  const ts = timestamp();
  const token = await getAccessToken();
  const normalizedPhone = normalizePhone(phone);
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');
  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: ts,
    TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    Amount: Math.max(1, Math.round(Number(amount))),
    PartyA: normalizedPhone,
    PartyB: shortcode,
    PhoneNumber: normalizedPhone,
    CallBackURL: callbackUrl,
    AccountReference: String(reference).slice(0, 50),
    TransactionDesc: String(description || 'Buy Me a Soda support').slice(0, 100)
  };
  const response = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ResponseCode !== '0') throw new Error(data.errorMessage || data.ResponseDescription || 'M-Pesa STK Push failed');
  return data;
}

module.exports = { startStkPush, normalizePhone };
