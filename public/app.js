// --- STATE ---
let currentShortId = null;
let pollTimer = null;

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
    .to('.gsap-card', { opacity: 1, y: 0, duration: 0.8, ease: "back.out(1.7)" }, "-=0.4")
    .fromTo('.gsap-content', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: "power2.out" }, "-=0.4");

  // Check URL parameter for direct link
  const params = new URLSearchParams(window.location.search);
  const paramLink = params.get('link') || params.get('id');
  if (paramLink) {
    linkInput.value = paramLink;
    handleLinkInput();
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
linkInput.addEventListener('input', handleLinkInput);
linkInput.addEventListener('paste', () => {
  // Small delay to let paste complete
  setTimeout(handleLinkInput, 50);
});

function handleLinkInput() {
  const val = linkInput.value.trim();
  errorMsg.classList.add('hidden');
  
  if (val.length > 3) {
    btnPay.disabled = false;
    btnText.textContent = 'Payer maintenant';
  } else {
    btnPay.disabled = true;
    btnText.textContent = 'Payer maintenant';
    amountPreview.classList.add('hidden');
    currentShortId = null;
  }
}

// --- PAYMENT FLOW ---
btnPay.addEventListener('click', async () => {
  const link = linkInput.value.trim();
  if (!link) return;

  // Loading state
  setLoading(true);
  errorMsg.classList.add('hidden');

  try {
    const res = await fetch('/api/resolve-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Code invalide.');
    if (data.status !== 'INITIATED' && data.status !== 'pending') {
      throw new Error('Ce code est expiré ou a déjà été utilisé.');
    }

    currentShortId = data.shortId;

    // Show amount preview and share button
    const amountDT = (data.amount / 1000).toFixed(0);
    amountValue.textContent = `${amountDT} DT`;
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
function openPayModal(url) {
  try {
    modalUrl.textContent = new URL(url).hostname;
  } catch(e) {
    modalUrl.textContent = 'ipay.clictopay.com';
  }
  modalExternal.href = url;
  payIframe.src = url;
  payModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

btnCloseModal.addEventListener('click', () => {
  payModal.classList.remove('active');
  payIframe.src = '';
  document.body.style.overflow = '';

  // Start polling for payment status
  if (currentShortId) {
    showVerifying();
    startStatusPolling(currentShortId);
  }
});

// --- SHARE LOGIC ---
btnShare.addEventListener('click', async () => {
  if (!currentShortId) return;
  const shareUrl = `${window.location.origin}${window.location.pathname}?link=${currentShortId}`;
  
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Paiement TunPay',
        text: 'Payez en ligne en toute sécurité via TunPay.',
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

function startStatusPolling(shortId) {
  let attempts = 0;
  const maxAttempts = 10;
  
  pollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`/api/check-status/${shortId}`);
      const data = await res.json();

      if (data.status === 'PAID' || data.status === 'paid' || data.status === 'SUCCESS') {
        clearInterval(pollTimer);
        const amountDT = (data.amount / 1000).toFixed(0);
        showResult('success', amountDT);
      } else if (data.status === 'FAILED' || data.status === 'EXPIRED' || data.status === 'CANCELLED') {
        clearInterval(pollTimer);
        showResult('fail');
      } else if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        // Still INITIATED — could be processing
        showResult('pending');
      }
    } catch (e) {
      if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        showResult('pending');
      }
    }
  }, 3000); // check every 3 seconds
}

// --- RESULT SCREEN ---
function showResult(type, amountDT) {
  spinnerAnim.stop();
  btnLoader.classList.add('hidden');

  // Hide payment card & info
  paymentCard.style.display = 'none';
  if (infoCard) infoCard.style.display = 'none';

  // Show result screen
  resultScreen.classList.remove('hidden');
  gsap.fromTo(resultScreen, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.5)" });

  if (type === 'success') {
    resultIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>`;
    resultIcon.className = 'result-icon result-success';
    resultTitle.textContent = 'Paiement réussi !';
    resultDesc.textContent = amountDT ? `${amountDT} DT ont été payés avec succès.` : 'Votre paiement a été traité avec succès.';
  } else if (type === 'fail') {
    resultIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`;
    resultIcon.className = 'result-icon result-fail';
    resultTitle.textContent = 'Paiement échoué';
    resultDesc.textContent = 'Le paiement n\'a pas abouti. Veuillez réessayer.';
  } else {
    resultIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;
    resultIcon.className = 'result-icon result-pending';
    resultTitle.textContent = 'Paiement en cours';
    resultDesc.textContent = 'Votre paiement est en cours de traitement. Vérifiez votre relevé bancaire.';
  }
}

// --- RESET FLOW ---
window.resetFlow = function() {
  // Clear state
  currentShortId = null;
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
