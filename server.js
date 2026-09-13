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
    puppeteerPage = await puppeteerBrowser.newPage();
    await puppeteerPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );
    // Block images/css/fonts to save bandwidth on Render
    await puppeteerPage.setRequestInterception(true);
    puppeteerPage.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
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

// Request SMS OTP via Kashy API (primary) or Puppeteer (fallback)
app.post('/api/admin/kashy-initiate-login', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Numéro de téléphone requis.' });

  const cleanPhone = phone.replace(/\s+/g, '');
  puppeteerState = { status: 'loading', message: 'Envoi du SMS...', phone: cleanPhone, lastUpdated: Date.now() };

  // Try direct API call to Kashy auth service
  try {
    console.log(`[Login] Initiating login for ${cleanPhone} via API...`);
    const directRes = await fetch('https://api.kashy.tn/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: cleanPhone })
    });
    const responseData = await directRes.json().catch(() => ({}));
    console.log(`[Login] API response status: ${directRes.status}`, JSON.stringify(responseData).slice(0, 200));

    if (directRes.ok || directRes.status === 200 || directRes.status === 201) {
      puppeteerState = { status: 'waiting_otp', message: `SMS envoyé au ${cleanPhone}. Entrez le code OTP reçu.`, phone: cleanPhone, lastUpdated: Date.now() };
      return res.json({ success: true, message: puppeteerState.message, method: 'api' });
    }
  } catch (e) {
    console.error('[Login] Direct API call failed:', e.message);
  }

  // Fallback: Puppeteer headless browser
  try {
    console.log(`[Login] Falling back to Puppeteer for ${cleanPhone}...`);
    const page = await getPuppeteerPage();
    await page.goto('https://app.kashy.tn/login', { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait a moment for JS to render
    await new Promise(r => setTimeout(r, 2000));

    // Try multiple selector strategies
    let phoneInput = null;
    const selectors = [
      'input[type="tel"]',
      'input[name="phone"]',
      'input[name="phoneNumber"]',
      'input[placeholder*="téléphone"]',
      'input[placeholder*="phone"]',
      'input[placeholder*="53"]',
      'input[placeholder*="numéro"]',
      'input[inputmode="numeric"]',
      'input[inputmode="tel"]'
    ];

    for (const sel of selectors) {
      try {
        phoneInput = await page.$(sel);
        if (phoneInput) {
          console.log(`[Login] Found phone input with selector: ${sel}`);
          break;
        }
      } catch(e) {}
    }

    // Last resort: find any visible input
    if (!phoneInput) {
      const allInputs = await page.$$('input');
      for (const inp of allInputs) {
        const isVisible = await inp.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        if (isVisible) {
          phoneInput = inp;
          console.log('[Login] Using first visible input as phone input.');
          break;
        }
      }
    }

    if (phoneInput) {
      await phoneInput.click({ clickCount: 3 });
      await phoneInput.press('Backspace');
      const phoneDigits = cleanPhone.replace('+216', '').replace(/\D/g, '');
      await phoneInput.type(phoneDigits, { delay: 50 });

      // Find and click submit button
      await new Promise(r => setTimeout(r, 500));
      const buttons = await page.$$('button');
      let clicked = false;
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.textContent.toLowerCase().trim());
        const isVisible = await btn.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (isVisible && (text.includes('connexion') || text.includes('login') || text.includes('envoyer') || text.includes('continuer') || text.includes('submit') || text.includes('suivant'))) {
          await btn.click();
          clicked = true;
          console.log(`[Login] Clicked button: "${text}"`);
          break;
        }
      }
      if (!clicked) {
        // Click first visible button as fallback
        for (const btn of buttons) {
          const isVisible = await btn.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (isVisible) {
            await btn.click();
            console.log('[Login] Clicked first visible button.');
            break;
          }
        }
      }
    }

    // Wait for navigation/response
    await new Promise(r => setTimeout(r, 3000));

    puppeteerState = { status: 'waiting_otp', message: `SMS envoyé au ${cleanPhone} (via navigateur). Entrez le code OTP.`, phone: cleanPhone, lastUpdated: Date.now() };
    res.json({ success: true, message: puppeteerState.message, method: 'puppeteer' });
  } catch (err) {
    console.error('[Login] Puppeteer error:', err);
    puppeteerState = { status: 'error', message: err.message, phone: cleanPhone, lastUpdated: Date.now() };
    res.status(500).json({ error: err.message });
  }
});

// Submit SMS OTP Code
app.post('/api/admin/kashy-submit-otp', async (req, res) => {
  const { otpCode } = req.body;
  if (!otpCode) return res.status(400).json({ error: 'Code OTP requis.' });

  const cleanOtp = String(otpCode).trim();
  const phone = puppeteerState.phone || '+21653772707';

  puppeteerState.status = 'verifying';
  puppeteerState.message = 'Validation du code OTP...';
  puppeteerState.lastUpdated = Date.now();

  // Strategy 1: Direct API verify-otp
  try {
    console.log(`[OTP] Verifying code ${cleanOtp} for ${phone} via API...`);

    // Try multiple possible API endpoints & payload formats
    const endpoints = [
      { url: 'https://api.kashy.tn/api/v1/auth/verify-otp', body: { phoneNumber: phone, code: cleanOtp } },
      { url: 'https://api.kashy.tn/api/v1/auth/verify-otp', body: { phoneNumber: phone, otp: cleanOtp } },
      { url: 'https://api.kashy.tn/api/v1/auth/verify', body: { phoneNumber: phone, code: cleanOtp } },
      { url: 'https://api.kashy.tn/api/v1/auth/verify', body: { phoneNumber: phone, verificationCode: cleanOtp } },
    ];

    for (const { url, body } of endpoints) {
      try {
        const directRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await directRes.json().catch(() => ({}));
        console.log(`[OTP] ${url} status: ${directRes.status}`, JSON.stringify(data).slice(0, 300));

        if (directRes.ok) {
          const rawToken = data.token || data.accessToken || data.bearer || data.access_token;
          if (rawToken) {
            const formatted = rawToken.trim().startsWith('Bearer ') ? rawToken.trim() : `Bearer ${rawToken.trim()}`;
            activeToken = formatted;
            process.env.KASHY_AUTH_TOKEN = formatted;

            const expMs = getTokenExpiry(formatted);
            const remainingMinutes = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 60000)) : null;

            puppeteerState = {
              status: 'connected',
              message: `Connecté à Kashy ! (~${remainingMinutes || '?'} min)`,
              phone,
              lastUpdated: Date.now(),
              lastRefresh: Date.now()
            };

            // Start auto-refresh loop
            startAutoRefreshLoop(phone);

            console.log(`[OTP] ✅ Login successful via API. Token valid for ~${remainingMinutes} min.`);
            return res.json({ success: true, remainingMinutes, method: 'api' });
          }
        }
      } catch(e) {}
    }
  } catch (e) {
    console.error('[OTP] Direct API error:', e.message);
  }

  // Strategy 2: Puppeteer OTP Submission
  try {
    console.log('[OTP] Falling back to Puppeteer...');
    const page = await getPuppeteerPage();

    // Try to find OTP input
    let otpInput = null;
    const otpSelectors = [
      'input[type="number"]',
      'input[name="otp"]',
      'input[name="code"]',
      'input[name="verificationCode"]',
      'input[placeholder*="code"]',
      'input[placeholder*="OTP"]',
      'input[placeholder*="vérification"]',
      'input[inputmode="numeric"]'
    ];

    for (const sel of otpSelectors) {
      try {
        otpInput = await page.$(sel);
        if (otpInput) {
          console.log(`[OTP] Found OTP input with selector: ${sel}`);
          break;
        }
      } catch(e) {}
    }

    // Fallback: find any visible input
    if (!otpInput) {
      const allInputs = await page.$$('input');
      for (const inp of allInputs) {
        const isVisible = await inp.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (isVisible) {
          otpInput = inp;
          break;
        }
      }
    }

    if (otpInput) {
      await otpInput.click({ clickCount: 3 });
      await otpInput.press('Backspace');
      await otpInput.type(cleanOtp, { delay: 30 });

      // Find and click verify button
      await new Promise(r => setTimeout(r, 500));
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.textContent.toLowerCase().trim());
        const isVisible = await btn.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (isVisible && (text.includes('vérifier') || text.includes('valider') || text.includes('confirmer') || text.includes('verify') || text.includes('submit') || text.includes('connexion'))) {
          await btn.click();
          console.log(`[OTP] Clicked button: "${text}"`);
          break;
        }
      }
    }

    // Wait for page to process and store token
    await new Promise(r => setTimeout(r, 5000));

    // Try to extract the token from localStorage/sessionStorage/cookies
    const extractedToken = await page.evaluate(() => {
      // Check various storage keys
      const keys = ['token', 'auth_token', 'bearer', 'access_token', 'accessToken', 'jwt', 'kashy_token'];
      for (const key of keys) {
        const val = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (val && val.length > 50) return val;
      }
      // Check for token in cookies
      const cookies = document.cookie.split(';');
      for (const c of cookies) {
        const [k, v] = c.trim().split('=');
        if (k && v && v.length > 50 && (k.includes('token') || k.includes('auth') || k.includes('jwt'))) return v;
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
        phone,
        lastUpdated: Date.now(),
        lastRefresh: Date.now()
      };

      // Start auto-refresh loop
      startAutoRefreshLoop(phone);

      console.log(`[OTP] ✅ Login successful via Puppeteer. Token valid for ~${remainingMinutes} min.`);
      return res.json({ success: true, remainingMinutes, method: 'puppeteer' });
    } else {
      puppeteerState = { status: 'error', message: 'Code OTP invalide ou session non générée.', phone, lastUpdated: Date.now() };
      return res.status(400).json({ error: 'Code OTP invalide ou jeton non extrait du navigateur.' });
    }
  } catch (err) {
    console.error('[OTP] Puppeteer error:', err);
    puppeteerState = { status: 'error', message: err.message, phone, lastUpdated: Date.now() };
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
