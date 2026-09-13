import puppeteer from 'puppeteer';

async function testKashyAuthApi() {
  console.log('--- Probing Kashy Auth APIs ---');
  const phone = '+21653772707';
  const routes = [
    '/api/v1/auth/login',
    '/api/v1/auth/client/login',
    '/api/v1/auth/request-otp',
    '/api/v1/auth/send-otp',
    '/api/v1/auth/otp/send',
    '/api/v1/auth/otp',
    '/api/v1/users/login',
    '/api/v1/clients/login'
  ];

  for (const r of routes) {
    try {
      const url = 'https://api.kashy.tn' + r;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone, phone })
      });
      console.log(`${r} -> Status: ${res.status}`);
      if (res.status !== 404) {
        const text = await res.text();
        console.log(`>>> SUCCESS/FOUND ${r}:`, text);
      }
    } catch(e) {
      console.log(`${r} -> Err: ${e.message}`);
    }
  }
}

async function testPuppeteerDOM() {
  console.log('\n--- Probing app.kashy.tn DOM ---');
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    console.log('Navigating to https://app.kashy.tn ...');
    await page.goto('https://app.kashy.tn', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('Current URL:', page.url());

    const title = await page.title();
    console.log('Page Title:', title);

    const inputs = await page.$$eval('input', list => list.map(i => ({
      type: i.type,
      name: i.name,
      id: i.id,
      placeholder: i.placeholder,
      className: i.className
    })));
    console.log('Inputs found:', JSON.stringify(inputs, null, 2));

    const buttons = await page.$$eval('button, a', list => list.map(b => ({
      text: b.innerText.trim(),
      href: b.href
    })).filter(b => b.text.length > 0));
    console.log('Buttons/Links found:', JSON.stringify(buttons, null, 2));

  } catch(e) {
    console.error('Puppeteer DOM probe err:', e);
  } finally {
    if (browser) await browser.close();
  }
}

async function run() {
  await testKashyAuthApi();
  await testPuppeteerDOM();
}

run();
