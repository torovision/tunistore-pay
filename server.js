import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3010;
const LINKS_FILE = join(__dirname, 'links.json');
let activeToken = process.env.KASHY_AUTH_TOKEN || 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTMxY2U3ZjliZTgyNTZjMzY1Y2JmZGQiLCJyb2xlIjoiY2xpZW50Iiwic3RhdHVzIjoidmVyaWZpZWQiLCJlbWFpbCI6ImNoaWhlYmVsb3VuaTZAZ21haWwuY29tIiwicGhvbmVOdW1iZXIiOiIrMjE2NTM3NzI3MDciLCJpYXQiOjE3ODkzMTk2NTEsImV4cCI6MTc4OTMyMTQ1MX0.oDPeccCVmwGanTG3dwP9tDBFIuQbxhseATPzPkuzJbU';

function getTokenExpiry(token) {
  try {
    const raw = token.replace('Bearer ', '').trim();
    const parts = raw.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      if (payload.exp) return payload.exp * 1000;
    }
  } catch (e) {}
  return null;
}

const app = express();
app.use(express.json());

// --- BACKEND LOGIC ---
function getLinks() {
  if (fs.existsSync(LINKS_FILE)) {
    return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  }
  return {};
}

function saveLinks(links) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2), 'utf8');
}

function sanitizeUrl(url, mdOrder) {
  if (url) return url.replace(':443', '').replace('/epg/', '/payment/');
  if (mdOrder && mdOrder !== 'fallback') {
    return `https://ipay.clictopay.com/payment/merchants/CLICTOPAY-2/p2p_payment.html?mdOrder=${mdOrder}&language=fr`;
  }
  return null;
}

/**
 * Extract short ID from various link formats:
 * - "0xqgxm"
 * - "https://app.kashy.tn/0xqgxm"
 * - "app.kashy.tn/0xqgxm"
 */
function extractShortId(input) {
  if (!input) return null;
  input = input.trim();
  // If it looks like a URL, extract the last path segment
  if (input.includes('kashy.tn') || input.includes('/')) {
    try {
      const url = input.startsWith('http') ? new URL(input) : new URL('https://' + input);
      const segments = url.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] || null;
    } catch (e) {
      // Not a valid URL, treat as short ID
    }
  }
  // Assume it's a raw short ID (alphanumeric, 4-12 chars)
  if (/^[a-zA-Z0-9]{4,12}$/.test(input)) return input;
  return null;
}

async function handleApi(shortId) {
  const authToken = activeToken;
  let sessionData = null;
  try {
    const r = await fetch(`https://api.kashy.tn/api/v1/payments/session/${shortId}`);
    if (r.ok) sessionData = await r.json();
  } catch (e) { console.error('session fetch err', e); }

  let rawFormUrl = '', orderId = '';
  try {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (authToken) {
      headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
    }
    const r = await fetch(`https://api.kashy.tn/api/v1/wallets/bank-card/generic-bank-card-register/payments/${shortId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    if (r.ok) {
      const d = await r.json();
      rawFormUrl = d.formUrl || '';
      orderId = d.orderId || d.orderNumber || '';
    } else {
      console.error('register fetch status:', r.status);
    }
  } catch (e) { console.error('register fetch err', e); }

  const finalUrl = sanitizeUrl(rawFormUrl, orderId);
  const amount = sessionData ? sessionData.amount : 100000;
  const status = sessionData ? sessionData.status : 'INITIATED';
  return { amount, formUrl: finalUrl, status };
}

// --- API ROUTES ---

// --- ADMIN AUTHENTICATION ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Battan25';

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Mot de passe requis.' });
  }

  if (password.trim().toLowerCase() === ADMIN_PASSWORD.toLowerCase()) {
    return res.json({ success: true, message: 'Authentification réussie.' });
  } else {
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
});

// Keep-alive ping
app.get('/api/ping', (req, res) => {
  res.json({ alive: true, ts: Date.now() });
});

// Update Kashy Token dynamically
app.post('/api/update-token', (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Jeton d\'autorisation invalide.' });
  }
  
  const formattedToken = token.trim().startsWith('Bearer ') ? token.trim() : `Bearer ${token.trim()}`;
  activeToken = formattedToken;
  process.env.KASHY_AUTH_TOKEN = formattedToken;
  
  const expMs = getTokenExpiry(formattedToken);
  const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

  console.log(`[Token Updated] Valid for ~${remainingMinutes || '?'} min`);
  res.json({ success: true, remainingMinutes });
});

// --- PUPPETEER AUTOMATED KASHY SESSION MANAGER ---
let puppeteerBrowser = null;
let puppeteerPage = null;
let puppeteerState = {
  status: 'idle',
  message: 'Aucun navigateur actif.',
  phone: null,
  lastUpdated: null
};

async function getPuppeteerPage() {
  if (!puppeteerBrowser || !puppeteerBrowser.isConnected()) {
    let puppeteer;
    try {
      puppeteer = await import('puppeteer');
    } catch (e) {
      throw new Error("Puppeteer n'est pas encore prêt sur le serveur.");
    }

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ];

    try {
      puppeteerBrowser = await puppeteer.default.launch({
        headless: true,
        args: launchArgs
      });
    } catch (err) {
      console.warn('Standard Puppeteer launch failed, checking system Chrome binaries...', err.message);
      const possiblePaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome-stable'
      ].filter(Boolean);

      let launched = false;
      for (const execPath of possiblePaths) {
        if (fs.existsSync(execPath)) {
          try {
            puppeteerBrowser = await puppeteer.default.launch({
              executablePath: execPath,
              headless: true,
              args: launchArgs
            });
            launched = true;
            break;
          } catch (e) {}
        }
      }

      if (!launched) {
        throw new Error(`Chrome n'a pas pu être lancé sur le serveur. (${err.message})`);
      }
    }
  }

  if (!puppeteerPage || puppeteerPage.isClosed()) {
    puppeteerPage = await puppeteerBrowser.newPage();
    await puppeteerPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
  }

  return puppeteerPage;
}

// Request SMS OTP via Puppeteer / Kashy Auth
app.post('/api/admin/kashy-initiate-login', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Numéro de téléphone requis.' });

  const cleanPhone = phone.replace(/\s+/g, '');
  puppeteerState = { status: 'loading', message: 'Lancement de la connexion...', phone: cleanPhone, lastUpdated: Date.now() };

  // First try direct API call to Kashy auth service
  try {
    const directRes = await fetch('https://api.kashy.tn/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: cleanPhone })
    });
    if (directRes.ok) {
      puppeteerState = { status: 'waiting_otp', message: `SMS envoyé au ${cleanPhone}. Entrez le code OTP reçu.`, phone: cleanPhone, lastUpdated: Date.now() };
      return res.json({ success: true, message: puppeteerState.message });
    }
  } catch (e) {}

  // Fallback to Puppeteer headless browser
  try {
    const page = await getPuppeteerPage();
    await page.goto('https://app.kashy.tn/login', { waitUntil: 'networkidle2', timeout: 30000 });

    const phoneInput = await page.waitForSelector('input[type="tel"], input[name="phone"], input[placeholder*="53"], input', { timeout: 10000 });
    if (phoneInput) {
      await phoneInput.click({ clickCount: 3 });
      await phoneInput.type(cleanPhone.replace('+216', ''));

      const submitBtn = await page.$('button[type="submit"], button');
      if (submitBtn) await submitBtn.click();
    }

    puppeteerState = { status: 'waiting_otp', message: `SMS envoyé au ${cleanPhone}. Entrez le code OTP reçu.`, phone: cleanPhone, lastUpdated: Date.now() };
    res.json({ success: true, message: puppeteerState.message });
  } catch (err) {
    console.error('Puppeteer initiate error:', err);
    puppeteerState = { status: 'error', message: 'Erreur: ' + err.message, phone: cleanPhone, lastUpdated: Date.now() };
    res.status(500).json({ error: err.message });
  }
});

// Submit SMS OTP Code
app.post('/api/admin/kashy-submit-otp', async (req, res) => {
  const { otpCode } = req.body;
  if (!otpCode) return res.status(400).json({ error: 'Code OTP requis.' });

  const cleanOtp = String(otpCode).trim();
  const phone = puppeteerState.phone || '+21653772707';

  // Try Direct API login with OTP first
  try {
    const directRes = await fetch('https://api.kashy.tn/api/v1/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: phone, code: cleanOtp })
    });

    if (directRes.ok) {
      const data = await directRes.json();
      const rawToken = data.token || data.accessToken || data.bearer;
      if (rawToken) {
        const formatted = rawToken.trim().startsWith('Bearer ') ? rawToken.trim() : `Bearer ${rawToken.trim()}`;
        activeToken = formatted;
        process.env.KASHY_AUTH_TOKEN = formatted;

        const expMs = getTokenExpiry(formatted);
        const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

        puppeteerState = { status: 'connected', message: `Connecté à Kashy ! (~${remainingMinutes || '?'} min)`, phone, lastUpdated: Date.now() };
        return res.json({ success: true, remainingMinutes });
      }
    }
  } catch (e) {}

  // Puppeteer OTP Submission Fallback
  try {
    const page = await getPuppeteerPage();
    const otpInput = await page.$('input[type="number"], input[placeholder*="code"], input[placeholder*="OTP"], input');
    if (otpInput) {
      await otpInput.click({ clickCount: 3 });
      await otpInput.type(cleanOtp);

      const submitBtn = await page.$('button[type="submit"], button');
      if (submitBtn) await submitBtn.click();
    }

    await new Promise(r => setTimeout(r, 3500));

    const extractedToken = await page.evaluate(() => {
      return localStorage.getItem('token') || 
             localStorage.getItem('auth_token') || 
             localStorage.getItem('bearer') || 
             sessionStorage.getItem('token');
    });

    if (extractedToken) {
      const formatted = extractedToken.trim().startsWith('Bearer ') ? extractedToken.trim() : `Bearer ${extractedToken.trim()}`;
      activeToken = formatted;
      process.env.KASHY_AUTH_TOKEN = formatted;

      const expMs = getTokenExpiry(formatted);
      const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

      puppeteerState = { status: 'connected', message: `Connecté à Kashy via Puppeteer ! (~${remainingMinutes || '?'} min)`, phone, lastUpdated: Date.now() };

      // Keep session alive every 10 min
      setInterval(async () => {
        try {
          if (puppeteerPage && !puppeteerPage.isClosed()) {
            await puppeteerPage.reload({ waitUntil: 'networkidle2' });
            const freshToken = await puppeteerPage.evaluate(() => localStorage.getItem('token') || localStorage.getItem('auth_token'));
            if (freshToken) {
              const freshFormatted = freshToken.trim().startsWith('Bearer ') ? freshToken.trim() : `Bearer ${freshToken.trim()}`;
              activeToken = freshFormatted;
              console.log('[Puppeteer Keep-Alive] Jeton Kashy synchronisé avec succès.');
            }
          }
        } catch(e) {}
      }, 10 * 60 * 1000);

      return res.json({ success: true, remainingMinutes });
    } else {
      return res.status(400).json({ error: 'Code OTP invalide ou jeton non généré.' });
    }
  } catch (err) {
    console.error('Puppeteer OTP submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Check Puppeteer Status
app.get('/api/admin/puppeteer-status', (req, res) => {
  res.json(puppeteerState);
});

// Get Token Status
app.get('/api/token-status', (req, res) => {
  const expMs = getTokenExpiry(activeToken);
  const isExpired = expMs ? Date.now() >= expMs : false;
  const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

  res.json({
    active: !isExpired,
    remainingMinutes,
    expiresAt: expMs ? new Date(expMs).toISOString() : null,
    puppeteerState
  });
});

// NEW: Resolve a Kashy link (accepts full URL or short ID)
app.post('/api/resolve-link', async (req, res) => {
  const { link } = req.body;
  const shortId = extractShortId(link);

  if (!shortId) {
    return res.status(400).json({ error: 'Code invalide. Entrez un code de paiement valide.' });
  }

  try {
    const result = await handleApi(shortId);
    if (!result.formUrl) {
      return res.status(400).json({ error: 'Session de paiement introuvable ou expirée sur Kashy.' });
    }
    res.json({ shortId, ...result });
  } catch (err) {
    console.error('resolve-link error', err);
    res.status(500).json({ error: 'Erreur de connexion au serveur de paiement.' });
  }
});

// NEW: Check payment status
app.get('/api/check-status/:shortId', async (req, res) => {
  const { shortId } = req.params;
  try {
    const r = await fetch(`https://api.kashy.tn/api/v1/payments/session/${shortId}`);
    if (!r.ok) return res.status(404).json({ error: 'Session introuvable.' });
    const data = await r.json();
    res.json({
      status: data.status || 'UNKNOWN',
      amount: data.amount || 0,
      shortId
    });
  } catch (err) {
    console.error('check-status error', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// NEW: Create or resolve link by dynamic amount (e.g. 231 DT or 180.120 TND)
app.post('/api/create-link-by-amount', async (req, res) => {
  const { amountDT } = req.body;
  const cleanStr = String(amountDT).replace(',', '.').replace(/[^\d.]/g, '');
  const numAmount = parseFloat(cleanStr);
  
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  const walletId = process.env.KASHY_WALLET_ID || '6a31ce809be8256c365cbfe3';
  const authToken = activeToken;
  const amountMillimes = Math.round(numAmount * 1000);

  if (authToken) {
    const authHeader = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
    
    try {
      const r = await fetch('https://api.kashy.tn/api/v1/payments/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({
          walletId,
          amount: amountMillimes,
          description: `Paiement ${numAmount} DT via TunPay`
        })
      });

      if (r.ok) {
        const data = await r.json();
        const shortId = data.shortId || data.id || data.code;
        if (shortId) {
          const apiRes = await handleApi(shortId);
          return res.json({ shortId, ...apiRes, amount: amountMillimes });
        }
      } else {
        const errText = await r.text();
        console.error('Kashy payments/request error status:', r.status, errText);
      }
    } catch (e) {
      console.error('Kashy link creation error:', e);
    }
  }

  // Fallback if token is expired or link creation fails
  const links = getLinks();
  const shortId = links[numAmount.toString()] || links[`${Math.round(numAmount)}`];
  if (shortId) {
    const apiRes = await handleApi(shortId);
    if (apiRes && apiRes.formUrl) {
      return res.json({ shortId, ...apiRes, amount: amountMillimes });
    }
  }

  res.status(401).json({ error: 'Session Kashy expirée. Veuillez recharger votre session Kashy ou fournir un jeton d\'autorisation valide.' });
});

// OLD: Resolve by amount (backward compatible)
app.get('/api/resolve-amount/:amount', async (req, res) => {
  const amountStr = req.params.amount;
  const links = getLinks();
  const shortId = links[amountStr];
  
  if (!shortId) return res.status(404).json({ error: 'Montant introuvable.' });

  try {
    const result = await handleApi(shortId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erreur Kashy API' });
  }
});

app.post('/api/admin/update', (req, res) => {
  const { id, shortId } = req.body;
  if (!id || !shortId) return res.status(400).json({ error: 'Données invalides.' });

  const links = getLinks();
  links[id] = shortId;
  saveLinks(links);
  res.json({ success: true });
});

// --- STATIC FRONTEND ---
app.use(express.static(join(__dirname, 'public')));

// Admin Route
app.get('/payx', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

// Fallback to index
app.use((req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  \x1b[1mTunPay Server\x1b[0m`);
  console.log(`  \x1b[2m────────────────────────────────────\x1b[0m`);
  console.log(`  Local:   \x1b[36mhttp://localhost:${PORT}/\x1b[0m`);
  console.log(`  Admin:   \x1b[36mhttp://localhost:${PORT}/payx\x1b[0m`);
  console.log();

  // --- KEEP-ALIVE: Self-ping every 10 minutes to prevent Render cold starts ---
  if (process.env.RENDER_EXTERNAL_URL || process.env.RENDER) {
    const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(async () => {
      try {
        await fetch(`${selfUrl}/api/ping`);
        console.log(`[keep-alive] pinged at ${new Date().toISOString()}`);
      } catch (e) { /* ignore */ }
    }, 10 * 60 * 1000); // every 10 minutes
  }
});
