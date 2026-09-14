// --- STATE ---
let currentShortId = null;
let pollTimer = null;
let createdLinkInput = null;
let createdLinkData = null;

// --- DOM ELEMENTS ---
const linkInput = document.getElementById('linkInput');
const btnPaste = document.getElementById('btnPaste');
const amountPreview = document.getElementById('amountPreview');
const amountValue = document.getElementById('amountValue');
const btnPay = document.getElementById('btnPay');
const btnText = document.getElementById('btnText');
const btnIcon = document.querySelector('.btn-icon');
const btnLoader = document.getElementById('btnLoader');
const errorMsg = document.getElementById('errorMsg');
const paymentCard = document.getElementById('paymentCard');
const resultScreen = document.getElementById('resultScreen');
const resultIcon = document.getElementById('resultIcon');
const resultTitle = document.getElementById('resultTitle');
const resultDesc = document.getElementById('resultDesc');
const infoCard = document.getElementById('infoCard');

const shareWrapper = document.getElementById('shareWrapper');
const btnShare = document.getElementById('btnShare');
const shareTooltip = document.getElementById('shareTooltip');

const payModal = document.getElementById('payModal');
const payIframe = document.getElementById('payIframe');
const modalUrl = document.getElementById('modalUrl');
const modalExternal = document.getElementById('modalExternal');
const btnCloseModal = document.getElementById('btnCloseModal');

// --- LOTTIE ANIMATION ---
let spinnerAnim = lottie.loadAnimation({
  container: btnLoader,
  renderer: 'svg',
  loop: true,
  autoplay: false,
  animationData: {"v":"5.5.2","fr":29.9700012207031,"ip":0,"op":30,"w":100,"h":100,"nm":"Spinner","ddd":0,"assets":[],"layers":[{"ddd":0,"ind":1,"ty":4,"nm":"Shape Layer 1","sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":1,"k":[{"i":{"x":[0.833],"y":[0.833]},"o":{"x":[0.167],"y":[0.167]},"t":0,"s":[0]},{"t":29.9700012207031,"s":[360]}],"ix":10},"p":{"a":0,"k":[50,50,0],"ix":2},"a":{"a":0,"k":[0,0,0],"ix":1},"s":{"a":0,"k":[100,100,100],"ix":6}},"ao":0,"shapes":[{"ty":"gr","it":[{"d":1,"ty":"el","s":{"a":0,"k":[80,80],"ix":2},"p":{"a":0,"k":[0,0],"ix":3},"nm":"Ellipse Path 1","mn":"ADBE Vector Shape - Ellipse","hd":false},{"ty":"st","c":{"a":0,"k":[0.05,0.06,0.04,1],"ix":3},"o":{"a":0,"k":100,"ix":4},"w":{"a":0,"k":8,"ix":5},"lc":2,"lj":1,"ml":4,"bm":0,"nm":"Stroke 1","mn":"ADBE Vector Graphic - Stroke","hd":false},{"ty":"tm","s":{"a":0,"k":0,"ix":1},"e":{"a":0,"k":25,"ix":2},"o":{"a":0,"k":0,"ix":3},"m":1,"ix":3,"nm":"Trim Paths 1","mn":"ADBE Vector Filter - Trim","hd":false},{"ty":"tr","p":{"a":0,"k":[0,0],"ix":2},"a":{"a":0,"k":[0,0],"ix":1},"s":{"a":0,"k":[100,100],"ix":3},"r":{"a":0,"k":0,"ix":6},"o":{"a":0,"k":100,"ix":7},"sk":{"a":0,"k":0,"ix":4},"sa":{"a":0,"k":0,"ix":5},"nm":"Transform"}],"nm":"Ellipse 1","np":3,"cix":2,"bm":0,"ix":1,"mn":"ADBE Vector Group","hd":false}],"ip":0,"op":30,"st":0,"bm":0}]}
});

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  // GSAP Entry Animations
  const tl = gsap.timeline();
  tl.to('.gsap-header', { opacity: 1, duration: 0.8, ease: "power2.out" })
    .fromTo('.logo-pay-pill', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: "back.out(2.5)" }, "-=0.5")
    .fromTo('.secure-tag', { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(2)" }, "-=0.4")
    .to('.gsap-card', { opacity: 1, y: 0, duration: 0.8, ease: "back.out(1.7)" }, "-=0.4")
    .fromTo('.hero-badge', { scale: 0.7, opacity: 0, y: -10 }, { scale: 1, opacity: 1, y: 0, duration: 0.55, ease: "back.out(2)" }, "-=0.6")
    .fromTo('.gsap-stat-card', { opacity: 0, y: 30, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.12, ease: "back.out(1.8)" }, "-=0.4")
    .fromTo('.gsap-content', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: "power2.out" }, "-=0.4");




  // Check URL parameter for direct link
  const params = new URLSearchParams(window.location.search);
  const paramLink = params.get('link') || params.get('id');
  if (paramLink) {
    linkInput.value = paramLink;
    handleLinkInput();
  }

  // Setup Preset Quick Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stopMainCardDemo();
      const amount = btn.getAttribute('data-amount');
      linkInput.value = amount;
      handleLinkInput();
      gsap.fromTo(linkInput, { scale: 1.03 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
      gsap.fromTo(btn, { scale: 1.15 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
    });
  });

  // Setup FAQ Accordion Toggles
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('active'));
      if (!isActive) item.classList.add('active');
    });
  });

  // Setup QR Code Toggle Button
  const btnToggleQr = document.getElementById('btnToggleQr');
  const qrBox = document.getElementById('qrBox');
  const qrImage = document.getElementById('qrImage');

  if (btnToggleQr && qrBox && qrImage) {
    btnToggleQr.addEventListener('click', () => {
      const isHidden = qrBox.classList.contains('hidden');
      if (isHidden) {
        const code = currentShortId || linkInput.value.trim();
        const shareUrl = `${window.location.origin}${window.location.pathname}?link=${encodeURIComponent(code)}`;
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`;
        qrBox.classList.remove('hidden');
        gsap.fromTo(qrBox, { opacity: 0, scale: 0.9, y: -10 }, { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "back.out(1.5)" });
      } else {
        qrBox.classList.add('hidden');
      }
    });
  }
});

// --- PASTE BUTTON ---
btnPaste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    linkInput.value = text;
    handleLinkInput();
    // Quick pulse animation
    gsap.fromTo(linkInput, { scale: 1.02 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
  } catch (e) {
    // Clipboard access denied, focus the input instead
    linkInput.focus();
  }
});

// --- LINK INPUT LOGIC ---
let resolveDebounceTimer = null;

linkInput.addEventListener('input', handleLinkInput);
linkInput.addEventListener('paste', () => {
  // Small delay to let paste complete
  setTimeout(handleLinkInput, 50);
});

function parseAmountInput(input) {
  if (!input) return null;
  const str = input.trim().replace(',', '.').replace(/\s*(DT|TND)$/i, '');
  if (/^\d+(\.\d+)?$/.test(str)) {
    const val = parseFloat(str);
    if (!isNaN(val) && val > 0) return val;
  }
  return null;
}

function formatTnd(millimes) {
  const dt = millimes / 1000;
  if (Number.isInteger(dt)) {
    return `${dt} DT`;
  }
  return `${dt.toFixed(3).replace(/\.?0+$/, '')} DT`;
}

function handleLinkInput() {
  const val = linkInput.value.trim();
  errorMsg.classList.add('hidden');
  clearTimeout(resolveDebounceTimer);
  
  const parsedNum = parseAmountInput(val);
  const isValidCode = val.length >= 4;

  if (parsedNum !== null) {
    if (parsedNum > 500) {
      btnPay.disabled = true;
      btnText.textContent = 'Payer maintenant';
      amountPreview.classList.add('hidden');
      shareWrapper.classList.add('hidden');
      errorMsg.textContent = 'Le montant maximum autorisé par transaction est de 500 DT.';
      errorMsg.classList.remove('hidden');
      return;
    }

    btnPay.disabled = false;
    btnText.textContent = 'Payer maintenant';
    // Instantly format & display amount preview locally (no Kashy API call during typing = no duplicate link)
    amountValue.textContent = formatTnd(parsedNum * 1000);
    amountPreview.classList.remove('hidden');
    shareWrapper.classList.remove('hidden');
    if (createdLinkInput !== val) {
      createdLinkInput = null;
      createdLinkData = null;
      currentShortId = null;
    }
  } else if (isValidCode) {
    btnPay.disabled = false;
    btnText.textContent = 'Payer maintenant';

    resolveDebounceTimer = setTimeout(() => {
      autoResolvePreview(val);
    }, 400);
  } else {
    btnPay.disabled = true;
    btnText.textContent = 'Payer maintenant';
    amountPreview.classList.add('hidden');
    shareWrapper.classList.add('hidden');
    currentShortId = null;
    createdLinkInput = null;
    createdLinkData = null;
  }
}

async function autoResolvePreview(input) {
  if (!userInteractedWithInput) return;
  const parsedNum = parseAmountInput(input);
  if (parsedNum !== null) return; // Numeric amounts are already previewed locally

  try {
    const res = await fetch('/api/resolve-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: input })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.amount > 500000) {
        errorMsg.textContent = 'Le montant de ce lien dépasse le maximum autorisé de 500 DT.';
        errorMsg.classList.remove('hidden');
        btnPay.disabled = true;
        amountPreview.classList.add('hidden');
        shareWrapper.classList.add('hidden');
        return;
      }
      currentShortId = data.shortId;
      amountValue.textContent = formatTnd(data.amount);
      amountPreview.classList.remove('hidden');
      shareWrapper.classList.remove('hidden');
      gsap.fromTo(amountPreview, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.3 });
      gsap.fromTo(shareWrapper, { opacity: 0 }, { opacity: 1, duration: 0.3, delay: 0.1 });
    } else {
      const errData = await res.json().catch(() => ({}));
      if (errData.error) {
        errorMsg.textContent = errData.error;
        errorMsg.classList.remove('hidden');
      }
    }
  } catch (e) {}
}

// --- PAYMENT FLOW ---
btnPay.addEventListener('click', async () => {
  const input = linkInput.value.trim();
  if (!input) return;

  // Loading state
  setLoading(true);
  errorMsg.classList.add('hidden');

  const parsedNum = parseAmountInput(input);
  const isNumericAmount = parsedNum !== null;

  if (isNumericAmount && parsedNum > 500) {
    setLoading(false);
    errorMsg.textContent = 'Le montant maximum autorisé par transaction est de 500 DT.';
    errorMsg.classList.remove('hidden');
    return;
  }

  try {
    let data;
    // Reuse generated link if already created for exact input string
    if (createdLinkInput === input && createdLinkData && createdLinkData.formUrl) {
      data = createdLinkData;
    } else {
      const endpoint = isNumericAmount ? '/api/create-link-by-amount' : '/api/resolve-link';
      const payload = isNumericAmount ? { amountDT: parsedNum } : { link: input };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Code ou montant invalide.');
      if (data.status !== 'INITIATED' && data.status !== 'pending') {
        throw new Error('Ce paiement a déjà été traité.');
      }

      createdLinkInput = input;
      createdLinkData = data;
    }

    currentShortId = data.shortId;

    // Show amount preview and share button
    amountValue.textContent = formatTnd(data.amount);
    amountPreview.classList.remove('hidden');
    shareWrapper.classList.remove('hidden');
    gsap.fromTo(amountPreview, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3 });
    gsap.fromTo(shareWrapper, { opacity: 0 }, { opacity: 1, duration: 0.3, delay: 0.1 });

    setLoading(false);

    // Open ClicToPay modal
    openPayModal(data.formUrl);

  } catch (err) {
    setLoading(false);
    errorMsg.textContent = err.message;
    errorMsg.classList.remove('hidden');
    gsap.fromTo('.card', { x: -10 }, { x: 10, duration: 0.1, yoyo: true, repeat: 3, ease: "power1.inOut", onComplete: () => gsap.set('.card', {x: 0}) });
  }
});

function setLoading(loading) {
  if (loading) {
    btnPay.disabled = true;
    btnText.classList.add('hidden');
    if (btnIcon) btnIcon.classList.add('hidden');
    btnLoader.classList.remove('hidden');
    spinnerAnim.play();
  } else {
    spinnerAnim.stop();
    btnLoader.classList.add('hidden');
    btnText.classList.remove('hidden');
    if (btnIcon) btnIcon.classList.remove('hidden');
    btnPay.disabled = false;
  }
}

// --- MODAL LOGIC ---
let iframeInitialLoaded = false;

function openPayModal(url) {
  try {
    modalUrl.textContent = new URL(url).hostname;
  } catch(e) {
    modalUrl.textContent = 'ipay.clictopay.com';
  }
  modalExternal.href = url;
  iframeInitialLoaded = false;
  const modalLoading = document.getElementById('modalLoading');
  if (modalLoading) modalLoading.style.display = 'flex';
  
  payIframe.src = url;
  payModal.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Start status polling immediately so when ClicToPay completes,
  // we auto-close the modal and display "Paiement réussi !"
  if (currentShortId) {
    startStatusPolling(currentShortId);
  }
}

function checkIframeRedirect() {
  try {
    let currentUrl = '';
    try {
      if (payIframe.contentWindow && payIframe.contentWindow.location) {
        currentUrl = payIframe.contentWindow.location.href;
      }
    } catch(e) {
      currentUrl = payIframe.src || '';
    }

    if (!currentUrl || currentUrl === 'about:blank') return false;

    const lower = currentUrl.toLowerCase();
    
    // Failure redirect check (e.g. https://app.kashy.tn/fr/payment/failure)
    if (
      lower.includes('app.kashy.tn/fr/payment/failure') ||
      lower.includes('/payment/failure') ||
      lower.includes('/payment/failed') ||
      lower.includes('payment/failure') ||
      lower.includes('status=failure') ||
      lower.includes('status=failed') ||
      lower.includes('result=failure') ||
      lower.includes('error=true')
    ) {
      console.log('[ClicToPay Redirect] Detected Payment Failure:', currentUrl);
      closePayModalSilently();
      showResult('fail');
      return true;
    }

    // Success redirect check (e.g. https://app.kashy.tn/fr/payment/success)
    if (
      lower.includes('app.kashy.tn/fr/payment/success') ||
      lower.includes('/payment/success') ||
      lower.includes('/payment/completed') ||
      lower.includes('payment/success') ||
      lower.includes('status=success') ||
      lower.includes('status=paid')
    ) {
      console.log('[ClicToPay Redirect] Detected Payment Success:', currentUrl);
      closePayModalSilently();
      showResult('success');
      return true;
    }
  } catch(e) {
    console.error('[Iframe Check Error]', e);
  }

  return false;
}

// Window Message Listener for PostMessage events from ClicToPay / Kashy iframe
window.addEventListener('message', (event) => {
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (!data) return;

    if (
      data.status === 'failure' ||
      data.status === 'FAILED' ||
      data.event === 'payment_failed' ||
      (data.url && (data.url.toLowerCase().includes('payment/failure') || data.url.toLowerCase().includes('failure')))
    ) {
      closePayModalSilently();
      showResult('fail');
    } else if (
      data.status === 'success' ||
      data.status === 'PAID' ||
      data.status === 'COMPLETED' ||
      data.event === 'payment_success' ||
      (data.url && (data.url.toLowerCase().includes('payment/success') || data.url.toLowerCase().includes('success')))
    ) {
      closePayModalSilently();
      showResult('success');
    }
  } catch(e) {}
});

payIframe.addEventListener('load', () => {
  if (!payIframe.src || payIframe.src === 'about:blank' || payIframe.src === window.location.href) return;
  const modalLoading = document.getElementById('modalLoading');
  
  if (!iframeInitialLoaded) {
    iframeInitialLoaded = true;
    if (modalLoading) modalLoading.style.display = 'none';
  }

  // Check if iframe redirected to failure/success URL or encountered X-Frame block
  const handled = checkIframeRedirect();
  if (!handled && currentShortId) {
    checkStatusNow(currentShortId);
  }
});

// Manual / Auto Check Status Handler from inside Modal
async function onCheckModalStatusClick() {
  if (!currentShortId) return;
  const btn = document.getElementById('btnCheckModalStatus');
  if (btn) {
    btn.textContent = '⌛ Vérification...';
    btn.disabled = true;
  }
  const isDone = await checkStatusNow(currentShortId);
  if (!isDone && btn) {
    btn.textContent = '⚡ Vérifier le statut';
    btn.disabled = false;
  }
}

btnCloseModal.addEventListener('click', () => {
  closePayModalSilently();

  // Start polling for payment status if not already finished
  if (currentShortId) {
    showVerifying();
    startStatusPolling(currentShortId);
  }
});

function closePayModalSilently() {
  if (pollTimer) clearInterval(pollTimer);
  payModal.classList.remove('active');
  payIframe.src = 'about:blank';
  document.body.style.overflow = '';
}

// --- SHARE LOGIC ---
btnShare.addEventListener('click', async () => {
  const code = currentShortId || linkInput.value.trim();
  if (!code) return;

  const shareUrl = `${window.location.origin}${window.location.pathname}?link=${encodeURIComponent(code)}`;
  
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Paiement ClicToPay — TunPay',
        text: 'Payez en ligne en toute sécurité via ClicToPay.',
        url: shareUrl
      });
    } catch (e) {
      copyToClipboard(shareUrl);
    }
  } else {
    copyToClipboard(shareUrl);
  }
});

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    shareTooltip.classList.remove('hidden');
    setTimeout(() => shareTooltip.classList.add('hidden'), 2000);
  });
}

// --- PAYMENT STATUS POLLING ---
function showVerifying() {
  btnPay.disabled = true;
  btnText.textContent = 'Vérification...';
  btnText.classList.remove('hidden');
  if (btnIcon) btnIcon.classList.add('hidden');
  btnLoader.classList.remove('hidden');
  spinnerAnim.play();
}

async function checkStatusNow(shortId) {
  try {
    const res = await fetch(`/api/check-status/${shortId}`);
    const data = await res.json();
    if (data.status === 'PAID' || data.status === 'paid' || data.status === 'SUCCESS' || data.status === 'COMPLETED') {
      closePayModalSilently();
      const amountDT = (data.amount / 1000).toFixed(0);
      showResult('success', amountDT);
      return true;
    } else if (data.status === 'FAILED' || data.status === 'EXPIRED' || data.status === 'CANCELLED') {
      closePayModalSilently();
      showResult('fail');
      return true;
    }
  } catch(e) {}

  return false;
}

function startStatusPolling(shortId) {
  if (pollTimer) clearInterval(pollTimer);
  let attempts = 0;
  const maxAttempts = 30; // 30 attempts * 2s = 60s
  
  pollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`/api/check-status/${shortId}`);
      const data = await res.json();

      if (data.status === 'PAID' || data.status === 'paid' || data.status === 'SUCCESS' || data.status === 'COMPLETED') {
        clearInterval(pollTimer);
        closePayModalSilently();
        const amountDT = (data.amount / 1000).toFixed(0);
        showResult('success', amountDT);
      } else if (data.status === 'FAILED' || data.status === 'EXPIRED' || data.status === 'CANCELLED') {
        clearInterval(pollTimer);
        closePayModalSilently();
        showResult('fail');
      } else if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        if (!resultScreen.classList.contains('hidden')) return;
        showResult('pending');
      }
    } catch (e) {
      if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        if (!resultScreen.classList.contains('hidden')) return;
        showResult('pending');
      }
    }
  }, 2000);
}

// --- RESULT SCREEN ---
function showResult(type, amountDT) {
  if (pollTimer) clearInterval(pollTimer);
  spinnerAnim.stop();
  btnLoader.classList.add('hidden');

  // Hide payment card & info
  paymentCard.style.display = 'none';
  if (infoCard) infoCard.style.display = 'none';

  // Show result screen
  resultScreen.classList.remove('hidden');

  const resultTitle = document.getElementById('resultTitle');
  const resultDesc = document.getElementById('resultDesc');
  const resultIcon = document.getElementById('resultIcon');
  const resultBtn = document.getElementById('resultBtn');
  const resultBtnText = document.getElementById('resultBtnText');
  const resultAmountBadge = document.getElementById('resultAmountBadge');
  const resultAmountVal = document.getElementById('resultAmountVal');

  gsap.killTweensOf([resultScreen, resultIcon, resultTitle, resultDesc, resultBtn]);

  if (type === 'fail' || type === 'failure' || type === 'FAILED') {
    // --- PAYMENT FAILED ---
    resultIcon.className = 'result-icon result-fail';
    resultIcon.innerHTML = `
      <div class="icon-pulse-bg red"></div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M15 9l-6 6M9 9l6 6"/>
      </svg>
    `;
    
    resultTitle.textContent = 'Paiement échoué';
    resultTitle.className = 'result-title text-fail';
    resultDesc.textContent = 'La transaction a été annulée ou n\'a pas pu être traitée via ClicToPay. Aucun montant n\'a été débité.';

    if (resultAmountBadge) resultAmountBadge.classList.add('hidden');

    if (resultBtnText) resultBtnText.textContent = 'Réessayer le paiement';
    if (resultBtn) {
      resultBtn.className = 'btn-primary result-btn btn-retry';
      resultBtn.onclick = () => window.resetFlow();
    }

    // GSAP Entry & Horizontal Shake Animation for Failure
    gsap.fromTo(resultScreen, 
      { opacity: 0, scale: 0.88, y: 25 }, 
      { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: "power3.out" }
    );

    gsap.fromTo(resultIcon,
      { scale: 0.3, rotation: -30 },
      { scale: 1, rotation: 0, duration: 0.55, ease: "back.out(2)" }
    );

    // Shake icon to emphasize payment failure
    gsap.to(resultIcon, {
      x: -10,
      duration: 0.07,
      repeat: 5,
      yoyo: true,
      ease: "sine.inOut",
      delay: 0.3,
      onComplete: () => gsap.set(resultIcon, { x: 0 })
    });

  } else if (type === 'success' || type === 'PAID' || type === 'COMPLETED') {
    // --- PAYMENT SUCCESSFUL ---
    resultIcon.className = 'result-icon result-success';
    resultIcon.innerHTML = `
      <div class="icon-pulse-bg green"></div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
    `;

    resultTitle.textContent = 'Paiement réussi !';
    resultTitle.className = 'result-title text-success';
    resultDesc.textContent = amountDT ? `${amountDT} DT ont été payés avec succès via ClicToPay.` : 'Votre paiement a été validé et traité avec succès.';

    if (resultAmountBadge && amountDT) {
      if (resultAmountVal) resultAmountVal.textContent = `${amountDT} DT`;
      resultAmountBadge.classList.remove('hidden');
    } else if (resultAmountBadge) {
      resultAmountBadge.classList.add('hidden');
    }

    if (resultBtnText) resultBtnText.textContent = 'Nouveau paiement';
    if (resultBtn) {
      resultBtn.className = 'btn-primary result-btn btn-success-action';
      resultBtn.onclick = () => window.resetFlow();
    }

    // GSAP Celebratory Spring Pop Animation for Success
    gsap.fromTo(resultScreen, 
      { opacity: 0, scale: 0.85, y: 30 }, 
      { opacity: 1, scale: 1, y: 0, duration: 0.55, ease: "back.out(1.7)" }
    );

    gsap.fromTo(resultIcon,
      { scale: 0, rotation: -60 },
      { scale: 1.15, rotation: 0, duration: 0.65, ease: "back.out(2.5)", onComplete: () => {
        gsap.to(resultIcon, { scale: 1, duration: 0.2, ease: "power1.out" });
      }}
    );

    if (resultAmountBadge && amountDT) {
      gsap.fromTo(resultAmountBadge,
        { opacity: 0, scale: 0.7, y: 10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.4, delay: 0.35, ease: "back.out(1.8)" }
      );
    }
  } else {
    // --- PENDING STATE ---
    resultIcon.className = 'result-icon result-pending';
    resultIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4M12 16h.01"/>
      </svg>
    `;
    resultTitle.textContent = 'Paiement en cours';
    resultTitle.className = 'result-title';
    resultDesc.textContent = 'Votre paiement est en cours de traitement. Veuillez vérifier votre compte.';

    if (resultAmountBadge) resultAmountBadge.classList.add('hidden');
    if (resultBtnText) resultBtnText.textContent = 'Retour au paiement';
    if (resultBtn) resultBtn.onclick = () => window.resetFlow();

    gsap.fromTo(resultScreen, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power2.out" });
  }
}

// --- RESET FLOW ---
window.resetFlow = function() {
  // Clear state
  currentShortId = null;
  createdLinkInput = null;
  createdLinkData = null;
  linkInput.value = '';
  amountPreview.classList.add('hidden');
  shareWrapper.classList.add('hidden');
  errorMsg.classList.add('hidden');
  btnPay.disabled = true;
  btnText.textContent = 'Payer maintenant';
  btnText.classList.remove('hidden');
  if (btnIcon) btnIcon.classList.remove('hidden');

  // Show payment card, hide result
  paymentCard.style.display = '';
  if (infoCard) infoCard.style.display = '';
  resultScreen.classList.add('hidden');

  // Re-animate
  gsap.fromTo('.card', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.5)" });
};

// --- MOCKUP TYPING ANIMATION LOOP ---
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeText(element, text, speed = 70) {
  element.textContent = '';
  const parent = element.parentElement;
  if (parent) parent.classList.add('typing');
  for (let i = 0; i < text.length; i++) {
    element.textContent += text[i];
    await delay(speed);
  }
  if (parent) parent.classList.remove('typing');
}

async function runMockupLoop() {
  const step1Code = document.getElementById('step1CodeVal');
  const step1Paste = document.getElementById('step1PasteBtn');
  const step1Btn = document.getElementById('step1Btn');

  const step2Cursor = document.getElementById('step2Cursor');
  const step2Btn = document.getElementById('step2Btn');

  const step3Num = document.querySelector('#step3CardNum .val');
  const step3Name = document.querySelector('#step3CardName .val');
  const step3Exp = document.querySelector('#step3CardExp .val');
  const step3Cvv = document.querySelector('#step3CardCvv .val');
  const step3PayBtn = document.getElementById('step3PayBtn');
  const step3Bg = document.getElementById('step3Bg');
  const step3Check = document.getElementById('step3Check');

  while (true) {
    // Reset all mockup states
    if (step1Code) step1Code.textContent = '';
    if (step1Btn) {
      step1Btn.style.background = 'var(--gray-100)';
      step1Btn.style.color = 'var(--gray-400)';
    }

    if (step3Num) step3Num.textContent = '';
    if (step3Name) step3Name.textContent = '';
    if (step3Exp) step3Exp.textContent = '';
    if (step3Cvv) step3Cvv.textContent = '';
    if (step3PayBtn) step3PayBtn.classList.remove('clicked');
    if (step3Bg) step3Bg.classList.remove('active');
    if (step3Check) step3Check.classList.remove('active');

    await delay(600);

    // STEP 1: Type Amount
    if (step1Code) {
      await typeText(step1Code, '180.120', 90);
      await delay(250);
      if (step1Paste) gsap.fromTo(step1Paste, { scale: 1.25 }, { scale: 1, duration: 0.25 });
      if (step1Btn) {
        step1Btn.style.background = 'var(--brand-green)';
        step1Btn.style.color = 'var(--brand-ink)';
      }
    }

    await delay(500);

    // STEP 2: Cursor Click
    if (step2Cursor && step2Btn) {
      gsap.fromTo(step2Cursor, { x: 15, y: 15 }, { x: 0, y: 0, duration: 0.5, ease: "power2.out" });
      await delay(500);
      gsap.fromTo(step2Btn, { scale: 0.94 }, { scale: 1, duration: 0.25 });
    }

    await delay(500);

    // STEP 3: Type Card Number, Name "Flen Ben Foulen", Exp, CVV & Click Pay
    if (step3Num) {
      await typeText(step3Num, '1234 5678 9012 3456', 45);
      await delay(150);
    }
    if (step3Name) {
      await typeText(step3Name, 'Flen Ben Foulen', 55);
      await delay(150);
    }
    if (step3Exp) {
      await typeText(step3Exp, '12/28', 60);
      await delay(100);
    }
    if (step3Cvv) {
      await typeText(step3Cvv, '789', 60);
      await delay(250);
    }

    // Click Pay Button
    if (step3PayBtn) {
      step3PayBtn.classList.add('clicked');
      await delay(250);
      step3PayBtn.classList.remove('clicked');
    }

    // Show Success Checkmark Popup
    if (step3Bg) step3Bg.classList.add('active');
    if (step3Check) step3Check.classList.add('active');

    // Pause on success state
    await delay(3500);
  }
}

// --- MAIN CARD AUTOMATED DEMO ---
let userInteractedWithInput = false;

function stopMainCardDemo() {
  if (userInteractedWithInput) return;
  userInteractedWithInput = true;
  const wrapper = document.querySelector('.link-input-wrapper');
  if (wrapper) wrapper.classList.remove('demo-active');
  if (btnPay) btnPay.classList.remove('demo-pulse');
}

async function runMainCardDemo() {
  const exampleCode = '180.120';
  const wrapper = document.querySelector('.link-input-wrapper');

  // Attach interaction listeners to stop demo when user interacts
  ['focus', 'click', 'keydown', 'paste', 'input', 'touchstart'].forEach(evt => {
    if (linkInput) linkInput.addEventListener(evt, stopMainCardDemo);
  });
  if (btnPaste) btnPaste.addEventListener('click', stopMainCardDemo);

  await delay(1500);

  if (userInteractedWithInput || (linkInput && linkInput.value.trim().length > 0)) {
    return;
  }

  if (wrapper) wrapper.classList.add('demo-active');

  // Type example code character by character (1 time only)
  for (let i = 0; i < exampleCode.length; i++) {
    if (userInteractedWithInput) break;
    if (linkInput) {
      linkInput.value += exampleCode[i];
      handleLinkInput();
    }
    await delay(120);
  }

  if (!userInteractedWithInput) {
    // Show amount preview simulation
    if (amountValue && amountPreview) {
      amountValue.textContent = '180.120 DT';
      amountPreview.classList.remove('hidden');
      gsap.fromTo(amountPreview, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3 });
    }
    if (btnPay) {
      btnPay.disabled = false;
      btnPay.classList.add('demo-pulse');
    }
    if (btnPaste) {
      gsap.fromTo(btnPaste, { scale: 1.2 }, { scale: 1, duration: 0.3 });
    }

    // Hold for 3 seconds so visitor sees how it works
    await delay(3000);
  }

  // Cleanly erase and reset back to clean state
  if (!userInteractedWithInput) {
    if (btnPay) btnPay.classList.remove('demo-pulse');
    for (let i = exampleCode.length; i >= 0; i--) {
      if (userInteractedWithInput) break;
      if (linkInput) {
        linkInput.value = exampleCode.substring(0, i);
        if (i < 4 && amountPreview) {
          amountPreview.classList.add('hidden');
          if (btnPay) btnPay.disabled = true;
        }
      }
      await delay(60);
    }
  }

  if (wrapper) wrapper.classList.remove('demo-active');
  if (!userInteractedWithInput) handleLinkInput();
}

// Start loops after page ready
document.addEventListener('DOMContentLoaded', () => {
  runMockupLoop();
  runMainCardDemo();
});
