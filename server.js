import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3010;
const LINKS_FILE = join(__dirname, 'links.json');

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
  return `https://ipay.clictopay.com/payment/merchants/CLICTOPAY-2/p2p_payment.html?mdOrder=${mdOrder}&language=fr`;
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
  let sessionData = null;
  try {
    const r = await fetch(`https://api.kashy.tn/api/v1/payments/session/${shortId}`);
    if (r.ok) sessionData = await r.json();
  } catch (e) { console.error('session fetch err', e); }

  let rawFormUrl = '', orderId = '';
  try {
    const r = await fetch(`https://api.kashy.tn/api/v1/wallets/bank-card/generic-bank-card-register/payments/${shortId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({})
    });
    if (r.ok) {
      const d = await r.json();
      rawFormUrl = d.formUrl || '';
      orderId = d.orderId || d.orderNumber || '';
    }
  } catch (e) { console.error('register fetch err', e); }

  const finalUrl = sanitizeUrl(rawFormUrl, orderId || 'fallback');
  const amount = sessionData ? sessionData.amount : 100000;
  const status = sessionData ? sessionData.status : 'INITIATED';
  return { amount, formUrl: finalUrl, status };
}

// --- API ROUTES ---

// Keep-alive ping
app.get('/api/ping', (req, res) => {
  res.json({ alive: true, ts: Date.now() });
});

// NEW: Resolve a Kashy link (accepts full URL or short ID)
app.post('/api/resolve-link', async (req, res) => {
  const { link } = req.body;
  const shortId = extractShortId(link);

  if (!shortId) {
    return res.status(400).json({ error: 'Lien invalide. Collez un lien de paiement valide.' });
  }

  try {
    const result = await handleApi(shortId);
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
