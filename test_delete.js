import fs from 'fs';

async function testDelete() {
  let token = process.env.KASHY_AUTH_TOKEN;
  if (!token && fs.existsSync('.env')) {
    const envText = fs.readFileSync('.env', 'utf8');
    const match = envText.match(/KASHY_AUTH_TOKEN=(.+)/);
    if (match) token = match[1].trim();
  }

  console.log('Using token:', token ? token.slice(0, 40) + '...' : 'none');
  if (!token) {
    console.log('No token found');
    return;
  }

  const walletId = '6a31ce809be8256c365cbfe3';
  const createRes = await fetch('https://api.kashy.tn/api/v1/payments/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
    },
    body: JSON.stringify({
      walletId,
      amount: 1000,
      description: 'Test Delete'
    })
  });

  console.log('Create Status:', createRes.status);
  const data = await createRes.json();
  console.log('Create Data:', JSON.stringify(data, null, 2));

  const id = data.id || data._id || data.requestId;
  const shortId = data.shortId || data.code;

  console.log('Extracted ID:', id, 'shortId:', shortId);

  // Test possible DELETE endpoints
  const testEndpoints = [
    { method: 'DELETE', url: `https://api.kashy.tn/api/v1/payments/request/${id}` },
    { method: 'DELETE', url: `https://api.kashy.tn/api/v1/payments/request/${shortId}` },
    { method: 'DELETE', url: `https://api.kashy.tn/api/v1/payments/${id}` },
    { method: 'DELETE', url: `https://api.kashy.tn/api/v1/payments/${shortId}` },
    { method: 'DELETE', url: `https://api.kashy.tn/api/v1/payments/link/${id}` },
    { method: 'DELETE', url: `https://api.kashy.tn/api/v1/payments/link/${shortId}` },
    { method: 'DELETE', url: `https://api.kashy.tn/api/v1/wallets/request/${id}` },
    { method: 'DELETE', url: `https://api.kashy.tn/api/v1/wallets/request/${shortId}` },
    { method: 'POST', url: `https://api.kashy.tn/api/v1/payments/request/${id}/cancel` },
    { method: 'POST', url: `https://api.kashy.tn/api/v1/payments/request/${shortId}/cancel` },
    { method: 'PATCH', url: `https://api.kashy.tn/api/v1/payments/request/${id}`, body: { status: 'CANCELLED' } }
  ];

  for (const ep of testEndpoints) {
    try {
      const opts = {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
        }
      };
      if (ep.body) opts.body = JSON.stringify(ep.body);

      const r = await fetch(ep.url, opts);
      const resText = await r.text();
      console.log(`${ep.method} ${ep.url} -> Status: ${r.status}, Body: ${resText.slice(0, 200)}`);
      if (r.ok || r.status === 200 || r.status === 204) {
        console.log('🎉 SUCCESS! Found delete endpoint:', ep.method, ep.url);
      }
    } catch (e) {
      console.log(`Error testing ${ep.url}:`, e.message);
    }
  }
}

testDelete();
