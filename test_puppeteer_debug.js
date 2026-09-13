import puppeteer from 'puppeteer';

async function debugKashyLogin() {
  console.log('--- Launching Puppeteer for Kashy Login Debug ---');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 450, height: 750 });

  page.on('console', msg => console.log('[PAGE CONSOLE]', msg.text()));
  page.on('requestfailed', req => console.log('[REQ FAIL]', req.url(), req.failure()?.errorText));

  page.on('response', async res => {
    if (res.url().includes('api.kashy.tn')) {
      console.log(`[API RESPONSE] ${res.status()} ${res.url()}`);
      try {
        const text = await res.text();
        console.log(`  Body: ${text}`);
      } catch(e) {}
    }
  });

  console.log('Navigating to https://app.kashy.tn/en/auth ...');
  await page.goto('https://app.kashy.tn/en/auth', { waitUntil: 'networkidle2' });

  // Type phone
  const phoneInput = await page.$('input[name="email"], input[type="tel"]');
  if (phoneInput) {
    await phoneInput.click({ clickCount: 3 });
    await phoneInput.press('Backspace');
    await phoneInput.type('53772707');
    console.log('Typed phone number');
  }

  // Type PIN (dummy or test)
  const pinInput = await page.$('input[name="pin"]');
  if (pinInput) {
    await pinInput.type('123456');
    console.log('Typed PIN 123456');
  }

  // Click Sign in
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await btn.evaluate(el => el.textContent.trim());
    if (text.toLowerCase().includes('sign in') || text.toLowerCase().includes('connexion')) {
      console.log('Clicking Sign in button...');
      await btn.click();
      break;
    }
  }

  console.log('Waiting 8 seconds to observe network and page state...');
  await new Promise(r => setTimeout(r, 8000));

  const pageContent = await page.evaluate(() => {
    const toasts = Array.from(document.querySelectorAll('[role="alert"], .toast, [data-toast], div[class*="destructive"], div[class*="error"]')).map(el => el.textContent.trim());
    return {
      url: window.location.href,
      toasts,
      bodyText: document.body.innerText.slice(0, 500)
    };
  });

  console.log('Page State:', JSON.stringify(pageContent, null, 2));
  await browser.close();
}

debugKashyLogin();
