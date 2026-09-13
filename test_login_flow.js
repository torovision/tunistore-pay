import puppeteer from 'puppeteer';

async function testKashyLoginFlow() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Intercept XHR/Fetch network requests
  page.on('request', req => {
    if (req.url().includes('/api/') || req.url().includes('kashy')) {
      console.log(`[REQ] ${req.method()} ${req.url()}`);
      if (req.postData()) {
        console.log(`  Payload: ${req.postData()}`);
      }
    }
  });

  page.on('response', async res => {
    if (res.url().includes('/api/') || res.url().includes('kashy')) {
      console.log(`[RES] ${res.status()} ${res.url()}`);
      try {
        const text = await res.text();
        console.log(`  Response: ${text.slice(0, 300)}`);
      } catch(e) {}
    }
  });

  console.log('Navigating to https://app.kashy.tn/en/auth ...');
  await page.goto('https://app.kashy.tn/en/auth', { waitUntil: 'networkidle2' });

  // Type phone number
  const phoneInput = await page.$('input[name="email"], input[type="tel"]');
  if (phoneInput) {
    await phoneInput.click({ clickCount: 3 });
    await phoneInput.press('Backspace');
    await phoneInput.type('53772707');
    console.log('Typed phone number 53772707');
  }

  // Type dummy PIN
  const pinInput = await page.$('input[name="pin"]');
  if (pinInput) {
    await pinInput.type('123456');
    console.log('Typed PIN 123456');
  }

  // Click Sign in button
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await btn.evaluate(el => el.textContent.trim());
    if (text.toLowerCase().includes('sign in') || text.toLowerCase().includes('connexion')) {
      console.log('Clicking Sign in button...');
      await btn.click();
      break;
    }
  }

  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
}

testKashyLoginFlow();
