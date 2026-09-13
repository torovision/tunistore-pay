import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.env.PUPPETEER_CACHE_DIR = join(__dirname, '.cache', 'puppeteer');
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
let autoRefreshTimer = null;
let puppeteerState = {
  status: 'idle',
  message: 'Aucun navigateur actif.',
  phone: null,
  lastUpdated: null,
  lastRefresh: null
};

/**
 * Recursively scan a directory for a chrome/chromium executable
 */
function findChromeInDir(dir) {
  try {
    if (!fs.existsSync(dir)) return null;
    const stat = fs.statSync(dir);
    // If it's a file and named chrome/chromium, return it
    if (!stat.isDirectory()) {
      const base = dir.split('/').pop().split('\\').pop();
      if (base === 'chrome' || base === 'chrome.exe' || base === 'chromium') return dir;
      return null;
    }
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const entryStat = fs.statSync(fullPath);
        if (!entryStat.isDirectory()) {
          if (entry === 'chrome' || entry === 'chrome.exe' || entry === 'chromium') return fullPath;
        } else {
          // Recurse into subdirectories (max 4 levels deep to avoid infinite scan)
          if (fullPath.split('/').length < dir.split('/').length + 5) {
            const found = findChromeInDir(fullPath);
            if (found) return found;
          }
        }
      } catch(e) {}
    }
  } catch(e) {}
  return null;
}

function findProjectChromeExecutable() {
  // 1. Project-local cache
  const projectCache = join(__dirname, '.cache', 'puppeteer');
  const projectChrome = findChromeInDir(projectCache);
  if (projectChrome) return projectChrome;

  // 2. Render default cache location
  const renderCache = '/opt/render/.cache/puppeteer';
  const renderChrome = findChromeInDir(renderCache);
  if (renderChrome) return renderChrome;

  // 3. Home directory cache
  const homeCache = join(process.env.HOME || '/root', '.cache', 'puppeteer');
  const homeChrome = findChromeInDir(homeCache);
  if (homeChrome) return homeChrome;

  return null;
}

function isBrowserConnected(browser) {
  if (!browser) return false;
  try {
    if (typeof browser.isConnected === 'function') return browser.isConnected();
    if (typeof browser.connected === 'boolean') return browser.connected;
    if (typeof browser.process === 'function') return browser.process() !== null;
    return true;
  } catch (e) {
    return false;
  }
}

function isPageOpen(page) {
  if (!page) return false;
  try {
    if (typeof page.isClosed === 'function') return !page.isClosed();
    if (typeof page.isClosed === 'boolean') return !page.isClosed;
    return true;
  } catch (e) {
    return false;
  }
}

async function getPuppeteerPage() {
  if (!isBrowserConnected(puppeteerBrowser)) {
    let puppeteerModule;
    try {
      puppeteerModule = await import('puppeteer');
    } catch (e) {
      throw new Error("Puppeteer n'est pas installé sur le serveur.");
    }
    const puppeteer = puppeteerModule.default || puppeteerModule;

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions'
    ];

    // Try project-detected chrome first
    const projectChromePath = findProjectChromeExecutable();
    console.log('[Puppeteer] Detected Chrome path:', projectChromePath || 'none (will use default)');

    const possiblePaths = [
      projectChromePath,
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ].filter(Boolean);

    let launched = false;
    for (const execPath of possiblePaths) {
      if (fs.existsSync(execPath)) {
        try {
          console.log(`[Puppeteer] Trying Chrome at: ${execPath}`);
          puppeteerBrowser = await puppeteer.launch({
            executablePath: execPath,
            headless: 'new',
            args: launchArgs
          });
          console.log(`[Puppeteer] Chrome launched successfully from: ${execPath}`);
          launched = true;
          break;
        } catch (e) {
          console.error(`[Puppeteer] Failed to launch from ${execPath}:`, e.message);
        }
      }
    }

    if (!launched) {
      try {
        // Let Puppeteer find its own bundled Chrome
        console.log('[Puppeteer] Trying default bundled Chrome...');
        puppeteerBrowser = await puppeteer.launch({
          headless: 'new',
          args: launchArgs
        });
        console.log('[Puppeteer] Default Chrome launched successfully.');
      } catch (err) {
        throw new Error(`Chrome introuvable sur le serveur. Assurez-vous que "npx puppeteer browsers install chrome" a été exécuté. (${err.message})`);
      }
    }
  }

  if (!isPageOpen(puppeteerPage)) {
    try {
      const context = puppeteerBrowser.defaultBrowserContext ? puppeteerBrowser.defaultBrowserContext() : puppeteerBrowser;
      if (context.overridePermissions) {
        await context.overridePermissions('https://app.kashy.tn', ['notifications']);
      }
    } catch(e) {}

    puppeteerPage = await puppeteerBrowser.newPage();

    // Mock Notification API so Firebase FCM doesn't throw "Notification permission denied" and halt React state
    await puppeteerPage.evaluateOnNewDocument(() => {
      try {
        window.Notification = class Notification {
          static permission = 'granted';
          static requestPermission() {
            return Promise.resolve('granted');
          }
          constructor() {}
        };
        if (navigator.permissions && navigator.permissions.query) {
          const origQuery = navigator.permissions.query;
          navigator.permissions.query = function(parameters) {
            if (parameters && parameters.name === 'notifications') {
              return Promise.resolve({ state: 'granted', onchange: null });
            }
            return origQuery.apply(this, arguments);
          };
        }
      } catch(e) {}
    });

    await puppeteerPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );
    // Allow CSS & JS so Next.js UI renders completely; only block heavy media & analytics
    await puppeteerPage.setRequestInterception(true);
    puppeteerPage.on('request', (req) => {
      const type = req.resourceType();
      const url = req.url();
      if (type === 'media' || url.includes('google-analytics') || url.includes('hotjar') || url.includes('sentry.io')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Capture Kashy auth API response errors
    puppeteerPage.on('response', async (res) => {
      if (res.url().includes('api.kashy.tn/api/v1/auth/login')) {
        try {
          const data = await res.json().catch(() => ({}));
          if (!res.ok() && data.errors && data.errors.length > 0) {
            const msg = data.errors[0].message || data.errors[0].code;
            console.log(`[Puppeteer Intercept Auth Error] ${msg}`);
            puppeteerState.lastError = msg;
            puppeteerState.status = 'error';
            puppeteerState.message = msg;
          }
        } catch(e) {}
      }
    });
  }

  return puppeteerPage;
}

/**
 * Start auto-refresh loop: re-authenticates with Kashy API every 25 min
 * so the 30-min JWT never expires while the server is running.
 */
function startAutoRefreshLoop(phone) {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  autoRefreshTimer = setInterval(async () => {
    console.log('[Auto-Refresh] Attempting Kashy token refresh...');

    // Strategy 1: If Puppeteer page is open with a valid session, extract fresh token
    try {
      if (isPageOpen(puppeteerPage)) {
        await puppeteerPage.reload({ waitUntil: 'networkidle2', timeout: 15000 });
        const freshToken = await puppeteerPage.evaluate(() => {
          return localStorage.getItem('token') ||
                 localStorage.getItem('auth_token') ||
                 localStorage.getItem('access_token') ||
                 sessionStorage.getItem('token');
        });
        if (freshToken && freshToken.length > 50) {
          const formatted = freshToken.trim().startsWith('Bearer ') ? freshToken.trim() : `Bearer ${freshToken.trim()}`;
          activeToken = formatted;
          process.env.KASHY_AUTH_TOKEN = formatted;
          const expMs = getTokenExpiry(formatted);
          const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;
          puppeteerState.status = 'connected';
          puppeteerState.message = `Session auto-rafraîchie (~${remainingMinutes || '?'} min)`;
          puppeteerState.lastRefresh = Date.now();
          puppeteerState.lastUpdated = Date.now();
          console.log(`[Auto-Refresh] Token refreshed via Puppeteer. ~${remainingMinutes} min remaining.`);
          return;
        }
      }
    } catch (e) {
      console.error('[Auto-Refresh] Puppeteer refresh failed:', e.message);
    }

    // Strategy 2: Try Kashy API refresh endpoint
    try {
      const currentRaw = activeToken.replace('Bearer ', '').trim();
      const refreshRes = await fetch('https://api.kashy.tn/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentRaw}`
        }
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        const rawToken = data.token || data.accessToken || data.bearer;
        if (rawToken) {
          const formatted = rawToken.trim().startsWith('Bearer ') ? rawToken.trim() : `Bearer ${rawToken.trim()}`;
          activeToken = formatted;
          process.env.KASHY_AUTH_TOKEN = formatted;
          const expMs = getTokenExpiry(formatted);
          const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;
          puppeteerState.status = 'connected';
          puppeteerState.message = `Session auto-rafraîchie via API (~${remainingMinutes || '?'} min)`;
          puppeteerState.lastRefresh = Date.now();
          puppeteerState.lastUpdated = Date.now();
          console.log(`[Auto-Refresh] Token refreshed via API. ~${remainingMinutes} min remaining.`);
          return;
        }
      }
    } catch (e) {
      console.error('[Auto-Refresh] API refresh failed:', e.message);
    }

    // If both strategies failed, mark as expired
    const expMs = getTokenExpiry(activeToken);
    if (expMs && Date.now() >= expMs) {
      puppeteerState.status = 'expired';
      puppeteerState.message = 'Session expirée. Reconnectez-vous via SMS OTP.';
      puppeteerState.lastUpdated = Date.now();
      console.log('[Auto-Refresh] Token expired. Manual re-login required.');
    }
  }, 25 * 60 * 1000); // Every 25 minutes
}

// Direct Kashy Login (Phone + Password/PIN) via API & Puppeteer fallback
app.post('/api/admin/kashy-login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Numéro de téléphone et Mot de passe / PIN requis.' });

  const cleanPhone = phone.replace(/\s+/g, '');
  puppeteerState = { status: 'loading', message: 'Connexion à Kashy...', phone: cleanPhone, lastUpdated: Date.now() };

  // 1. Direct API Login
  try {
    console.log(`[Login] Attempting API login for ${cleanPhone}...`);
    const directRes = await fetch('https://api.kashy.tn/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: cleanPhone,
        password: password,
        deviceId: 'tunpay_' + Math.random().toString(36).substring(2, 9),
        deviceMeta: { platform: 'web' }
      })
    });

    const data = await directRes.json().catch(() => ({}));
    console.log(`[Login] Kashy API status: ${directRes.status}`, JSON.stringify(data).slice(0, 300));

    if (directRes.ok) {
      const rawToken = data.token || data.accessToken || data.bearer || data.access_token || (data.data && data.data.token);
      if (rawToken) {
        const formatted = rawToken.trim().startsWith('Bearer ') ? rawToken.trim() : `Bearer ${rawToken.trim()}`;
        activeToken = formatted;
        process.env.KASHY_AUTH_TOKEN = formatted;

        const expMs = getTokenExpiry(formatted);
        const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

        puppeteerState = {
          status: 'connected',
          message: `Connecté à Kashy ! (~${remainingMinutes || '?'} min)`,
          phone: cleanPhone,
          lastUpdated: Date.now(),
          lastRefresh: Date.now()
        };

        startAutoRefreshLoop(cleanPhone);
        return res.json({ success: true, remainingMinutes, method: 'api' });
      } else {
        puppeteerState = { status: 'waiting_otp', message: 'SMS OTP envoyé sur votre téléphone. Saisissez le code ci-dessous.', phone: cleanPhone, lastUpdated: Date.now() };
        return res.json({ success: true, requireOtp: true, message: puppeteerState.message });
      }
    }

    // Extract API error message if direct API call failed with error
    let apiErrMsg = null;
    if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
      apiErrMsg = data.errors[0].message || data.errors[0].code;
    } else if (data.message) {
      apiErrMsg = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
    } else if (data.error) {
      apiErrMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    }

    if (!directRes.ok && apiErrMsg) {
      console.log(`[Login] API returned error: ${apiErrMsg}`);
      // If error indicates OTP was already sent, trigger OTP step
      if (apiErrMsg.toLowerCase().includes('otp was sent') || apiErrMsg.toLowerCase().includes('code envoyé')) {
        puppeteerState = { status: 'waiting_otp', message: apiErrMsg, phone: cleanPhone, lastUpdated: Date.now() };
        return res.json({ success: true, requireOtp: true, message: apiErrMsg });
      }
      puppeteerState = { status: 'error', message: apiErrMsg, phone: cleanPhone, lastUpdated: Date.now() };
      return res.status(directRes.status || 400).json({ error: apiErrMsg });
    }
  } catch (e) {
    console.error('[Login] API login error:', e.message);
  }

  // 2. Fallback to Puppeteer Browser
  try {
    console.log(`[Login] Falling back to Puppeteer browser for ${cleanPhone}...`);
    const page = await getPuppeteerPage();
    await page.goto('https://app.kashy.tn/en/auth', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const phoneInput = await page.$('input[name="email"], input[type="tel"]');
    if (phoneInput) {
      await phoneInput.click({ clickCount: 3 });
      await phoneInput.press('Backspace');
      await phoneInput.type(cleanPhone.replace('+216', '').replace(/\D/g, ''), { delay: 40 });
    }

    const pinInput = await page.$('input[name="pin"], input[type="password"]');
    if (pinInput) {
      await pinInput.click({ clickCount: 3 });
      await pinInput.press('Backspace');
      await pinInput.type(password, { delay: 40 });
    }

    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.evaluate(el => el.textContent.toLowerCase().trim());
      if (text.includes('sign in') || text.includes('connexion') || text.includes('se connecter')) {
        await btn.click();
        break;
      }
    }

    await new Promise(r => setTimeout(r, 4000));

    // Try to extract page error message if visible
    const pageErrorText = await page.evaluate(() => {
      const selectors = ['[role="alert"]', '.toast', '[data-toast]', '.text-destructive', '.error-message', 'div[class*="destructive"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 3) {
          return el.textContent.trim();
        }
      }
      return null;
    });

    if (pageErrorText && !pageErrorText.toLowerCase().includes('otp')) {
      puppeteerState = { status: 'error', message: pageErrorText, phone: cleanPhone, lastUpdated: Date.now() };
      return res.status(400).json({ error: pageErrorText });
    }

    const extractedToken = await page.evaluate(() => {
      const keys = ['token', 'auth_token', 'bearer', 'access_token', 'accessToken', 'jwt', 'kashy_token'];
      for (const key of keys) {
        const val = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (val && val.length > 50) return val;
      }
      return null;
    });

    if (extractedToken) {
      const formatted = extractedToken.trim().startsWith('Bearer ') ? extractedToken.trim() : `Bearer ${extractedToken.trim()}`;
      activeToken = formatted;
      process.env.KASHY_AUTH_TOKEN = formatted;

      const expMs = getTokenExpiry(formatted);
      const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

      puppeteerState = {
        status: 'connected',
        message: `Connecté via navigateur ! (~${remainingMinutes || '?'} min)`,
        phone: cleanPhone,
        lastUpdated: Date.now(),
        lastRefresh: Date.now()
      };

      startAutoRefreshLoop(cleanPhone);
      return res.json({ success: true, remainingMinutes, method: 'puppeteer' });
    } else {
      puppeteerState = { status: 'waiting_otp', message: 'SMS OTP envoyé sur votre téléphone. Entrez le code ci-dessous.', phone: cleanPhone, lastUpdated: Date.now() };
      return res.json({ success: true, requireOtp: true, message: puppeteerState.message });
    }
  } catch (err) {
    console.error('[Login] Puppeteer login error:', err);
    puppeteerState = { status: 'error', message: err.message, phone: cleanPhone, lastUpdated: Date.now() };
    res.status(500).json({ error: err.message });
  }
});

// Submit SMS OTP Code
app.post('/api/admin/kashy-submit-otp', async (req, res) => {
  const { phone, otpCode } = req.body;
  if (!otpCode) return res.status(400).json({ error: 'Code OTP (6 chiffres) requis.' });

  const cleanOtp = String(otpCode).trim();
  const cleanPhone = (phone || puppeteerState.phone || '+21653772707').replace(/\s+/g, '');

  console.log(`[OTP] Submitting OTP code "${cleanOtp}" for ${cleanPhone}...`);

  // 1. Try Direct API Verification
  const verifyEndpoints = [
    { url: 'https://api.kashy.tn/api/v1/auth/verify-otp', body: { phoneNumber: cleanPhone, code: cleanOtp } },
    { url: 'https://api.kashy.tn/api/v1/auth/verify-otp', body: { phoneNumber: cleanPhone, otp: cleanOtp } },
    { url: 'https://api.kashy.tn/api/v1/auth/verify', body: { phoneNumber: cleanPhone, code: cleanOtp } },
    { url: 'https://api.kashy.tn/api/v1/auth/login', body: { phoneNumber: cleanPhone, code: cleanOtp } }
  ];

  for (const { url, body } of verifyEndpoints) {
    try {
      const directRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await directRes.json().catch(() => ({}));
      if (directRes.ok) {
        const rawToken = data.token || data.accessToken || data.bearer || data.access_token || (data.data && data.data.token);
        if (rawToken) {
          const formatted = rawToken.trim().startsWith('Bearer ') ? rawToken.trim() : `Bearer ${rawToken.trim()}`;
          activeToken = formatted;
          process.env.KASHY_AUTH_TOKEN = formatted;

          const expMs = getTokenExpiry(formatted);
          const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

          puppeteerState = {
            status: 'connected',
            message: `Connecté à Kashy ! (~${remainingMinutes || '?'} min)`,
            phone: cleanPhone,
            lastUpdated: Date.now(),
            lastRefresh: Date.now()
          };

          startAutoRefreshLoop(cleanPhone);
          return res.json({ success: true, remainingMinutes, method: 'api' });
        }
      }
    } catch(e) {}
  }

  // 2. Puppeteer OTP Submission Fallback
  try {
    const page = await getPuppeteerPage();

    const inputs = await page.$$('input');
    let typed = false;
    for (const inp of inputs) {
      const isVisible = await inp.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (isVisible) {
        await inp.click({ clickCount: 3 });
        await inp.press('Backspace');
        await inp.type(cleanOtp, { delay: 40 });
        typed = true;
        break;
      }
    }

    if (typed) {
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.textContent.toLowerCase().trim());
        if (text.includes('verify') || text.includes('valider') || text.includes('confirm') || text.includes('submit') || text.includes('connexion')) {
          await btn.click();
          break;
        }
      }
    }

    await new Promise(r => setTimeout(r, 4000));

    const extractedToken = await page.evaluate(() => {
      const keys = ['token', 'auth_token', 'bearer', 'access_token', 'accessToken', 'jwt', 'kashy_token'];
      for (const k of keys) {
        const val = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (val && val.length > 50) return val;
      }
      return null;
    });

    if (extractedToken) {
      const formatted = extractedToken.trim().startsWith('Bearer ') ? extractedToken.trim() : `Bearer ${extractedToken.trim()}`;
      activeToken = formatted;
      process.env.KASHY_AUTH_TOKEN = formatted;

      const expMs = getTokenExpiry(formatted);
      const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

      puppeteerState = {
        status: 'connected',
        message: `Connecté via navigateur ! (~${remainingMinutes || '?'} min)`,
        phone: cleanPhone,
        lastUpdated: Date.now(),
        lastRefresh: Date.now()
      };

      startAutoRefreshLoop(cleanPhone);
      return res.json({ success: true, remainingMinutes, method: 'puppeteer' });
    } else {
      return res.status(400).json({ error: 'Code OTP invalide ou non reconnu.' });
    }
  } catch (err) {
    console.error('[OTP] Error submitting OTP:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- LIVE PUPPETEER REMOTE CONTROL ENDPOINTS ---

// Start or reset live browser view
app.post('/api/admin/browser/start', async (req, res) => {
  try {
    console.log('[LiveBrowser] Launching live visual screen...');
    const page = await getPuppeteerPage();
    await page.setViewport({ width: 450, height: 750, deviceScaleFactor: 1 });
    await page.goto('https://app.kashy.tn/en/auth', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    const imageBuffer = await page.screenshot({ type: 'jpeg', quality: 65 });
    const base64 = imageBuffer.toString('base64');

    res.json({ success: true, image: `data:image/jpeg;base64,${base64}` });
  } catch (err) {
    console.error('[LiveBrowser] Start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Interact with live browser (click, type, press, extract token)
app.post('/api/admin/browser/interact', async (req, res) => {
  const { action, x, y, text, key } = req.body;
  try {
    const page = await getPuppeteerPage();

    if (action === 'click' && typeof x === 'number' && typeof y === 'number') {
      console.log(`[LiveBrowser] Click at (${x}, ${y})`);
      await page.mouse.click(x, y);
      await new Promise(r => setTimeout(r, 2000));
    } else if (action === 'type' && text) {
      console.log(`[LiveBrowser] Type text: "${text}"`);
      await page.keyboard.type(text, { delay: 40 });
      await new Promise(r => setTimeout(r, 2000));
    } else if (action === 'press' && key) {
      console.log(`[LiveBrowser] Press key: "${key}"`);
      await page.keyboard.press(key);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Check if token became available in storage
    const extractedToken = await page.evaluate(() => {
      const keys = ['token', 'auth_token', 'bearer', 'access_token', 'accessToken', 'jwt', 'kashy_token'];
      for (const k of keys) {
        const val = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (val && val.length > 50) return val;
      }
      return null;
    });

    if (extractedToken) {
      const formatted = extractedToken.trim().startsWith('Bearer ') ? extractedToken.trim() : `Bearer ${extractedToken.trim()}`;
      activeToken = formatted;
      process.env.KASHY_AUTH_TOKEN = formatted;

      const expMs = getTokenExpiry(formatted);
      const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

      puppeteerState = {
        status: 'connected',
        message: `Connecté via l'écran en direct ! (~${remainingMinutes || '?'} min)`,
        phone: puppeteerState.phone || '+21653772707',
        lastUpdated: Date.now(),
        lastRefresh: Date.now()
      };

      startAutoRefreshLoop(puppeteerState.phone);
    }

    const imageBuffer = await page.screenshot({ type: 'jpeg', quality: 65 });
    const base64 = imageBuffer.toString('base64');

    const lastErr = puppeteerState.lastError;
    if (lastErr) puppeteerState.lastError = null;

    res.json({
      success: true,
      image: `data:image/jpeg;base64,${base64}`,
      hasToken: !!extractedToken,
      tokenState: puppeteerState,
      error: lastErr || null
    });
  } catch (err) {
    console.error('[LiveBrowser] Interact error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Fast screenshot endpoint for live stream polling
app.get('/api/admin/browser/screenshot', async (req, res) => {
  try {
    if (!puppeteerPage || !isPageOpen(puppeteerPage)) {
      return res.status(404).json({ error: 'Page non active.' });
    }
    const imageBuffer = await puppeteerPage.screenshot({ type: 'jpeg', quality: 65 });
    const base64 = imageBuffer.toString('base64');
    
    const lastErr = puppeteerState.lastError;
    if (lastErr) puppeteerState.lastError = null;

    res.json({
      success: true,
      image: `data:image/jpeg;base64,${base64}`,
      error: lastErr || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check Puppeteer / Session Status
app.get('/api/admin/puppeteer-status', (req, res) => {
  const expMs = getTokenExpiry(activeToken);
  const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;
  const isExpired = expMs ? Date.now() >= expMs : true;

  // Auto-update puppeteerState if token expired
  if (isExpired && puppeteerState.status === 'connected') {
    puppeteerState.status = 'expired';
    puppeteerState.message = 'Session expirée. Reconnectez-vous.';
    puppeteerState.lastUpdated = Date.now();
  }

  res.json({
    ...puppeteerState,
    tokenActive: !isExpired,
    remainingMinutes,
    autoRefreshActive: !!autoRefreshTimer
  });
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
    autoRefreshActive: !!autoRefreshTimer,
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
