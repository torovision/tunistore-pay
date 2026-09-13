async function testCreateLinkRoutes() {
  const token = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTMxY2U3ZjliZTgyNTZjMzY1Y2JmZGQiLCJyb2xlIjoiY2xpZW50Iiwic3RhdHVzIjoidmVyaWZpZWQiLCJlbWFpbCI6ImNoaWhlYmVsb3VuaTZAZ21haWwuY29tIiwicGhvbmVOdW1iZXIiOiIrMjE2NTM3NzI3MDciLCJpYXQiOjE3ODkzMTc5ODEsImV4cCI6MTc4OTMxOTc4MX0.cI0Er6M3hqcOe-_Hx_-tJpiwCn6sI7CvFBqRktFjMY8';
  const walletId = '6a31ce809be8256c365cbfe3';

  const routes = [
    `/api/v1/wallets/${walletId}/links`,
    `/api/v1/wallets/${walletId}/payment-links`,
    `/api/v1/wallets/${walletId}/sessions`,
    `/api/v1/wallets/links`,
    `/api/v1/wallets/payment-links`,
    `/api/v1/payments`,
    `/api/v1/payment-links`,
    `/api/v1/payments/link`,
    `/api/v1/links`,
    `/api/v1/wallets/session`,
    `/api/v1/payments/create`,
    `/api/v1/wallets/create-link`
  ];

  for (const r of routes) {
    const url = 'https://api.kashy.tn' + r;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token },
        body: JSON.stringify({ walletId, amount: 25000, description: 'Test' })
      });
      console.log(r, '-> Status:', res.status);
      const text = await res.text();
      if (res.status !== 404) {
        console.log('>>> FOUND ROUTE:', r, 'Status:', res.status, 'Body:', text);
      }
    } catch(e) {
      console.log(r, 'Err:', e.message);
    }
  }
}

testCreateLinkRoutes();
