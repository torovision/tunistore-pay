// --- CONSTANTS & STATE ---
const amounts = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 350, 400, 450, 500];
let selectedAmount = null;

// --- DOM ELEMENTS ---
const amountInput = document.getElementById('amountInput');
const suggestionBox = document.getElementById('suggestionBox');
const btnOpenSheet = document.getElementById('btnOpenSheet');
const amountSheetOverlay = document.getElementById('amountSheetOverlay');
const amountsList = document.getElementById('amountsList');
const btnCloseSheet = document.getElementById('btnCloseSheet');

const btnPay = document.getElementById('btnPay');
const btnText = document.getElementById('btnText');
const btnIcon = document.querySelector('.btn-icon');
const btnLoader = document.getElementById('btnLoader');
const errorMsg = document.getElementById('errorMsg');

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
  // Minimalist white spinner JSON inline for speed
  animationData: {"v":"5.5.2","fr":29.9700012207031,"ip":0,"op":30,"w":100,"h":100,"nm":"Spinner","ddd":0,"assets":[],"layers":[{"ddd":0,"ind":1,"ty":4,"nm":"Shape Layer 1","sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":1,"k":[{"i":{"x":[0.833],"y":[0.833]},"o":{"x":[0.167],"y":[0.167]},"t":0,"s":[0]},{"t":29.9700012207031,"s":[360]}],"ix":10},"p":{"a":0,"k":[50,50,0],"ix":2},"a":{"a":0,"k":[0,0,0],"ix":1},"s":{"a":0,"k":[100,100,100],"ix":6}},"ao":0,"shapes":[{"ty":"gr","it":[{"d":1,"ty":"el","s":{"a":0,"k":[80,80],"ix":2},"p":{"a":0,"k":[0,0],"ix":3},"nm":"Ellipse Path 1","mn":"ADBE Vector Shape - Ellipse","hd":false},{"ty":"st","c":{"a":0,"k":[1,1,1,1],"ix":3},"o":{"a":0,"k":100,"ix":4},"w":{"a":0,"k":8,"ix":5},"lc":2,"lj":1,"ml":4,"bm":0,"nm":"Stroke 1","mn":"ADBE Vector Graphic - Stroke","hd":false},{"ty":"tm","s":{"a":0,"k":0,"ix":1},"e":{"a":0,"k":25,"ix":2},"o":{"a":0,"k":0,"ix":3},"m":1,"ix":3,"nm":"Trim Paths 1","mn":"ADBE Vector Filter - Trim","hd":false},{"ty":"tr","p":{"a":0,"k":[0,0],"ix":2},"a":{"a":0,"k":[0,0],"ix":1},"s":{"a":0,"k":[100,100],"ix":3},"r":{"a":0,"k":0,"ix":6},"o":{"a":0,"k":100,"ix":7},"sk":{"a":0,"k":0,"ix":4},"sa":{"a":0,"k":0,"ix":5},"nm":"Transform"}],"nm":"Ellipse 1","np":3,"cix":2,"bm":0,"ix":1,"mn":"ADBE Vector Group","hd":false}],"ip":0,"op":30,"st":0,"bm":0}]}
});

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  // 1. Render iOS Sheet Items
  amounts.forEach(amt => {
    const item = document.createElement('div');
    item.className = 'ios-sheet-item';
    item.textContent = `${amt} DT`;
    item.onclick = () => selectAmount(amt);
    amountsList.appendChild(item);
  });

  // Handle URL Parameter for pre-filled amount
  const params = new URLSearchParams(window.location.search);
  const paramAmt = parseInt(params.get('amount'));
  if (paramAmt) {
    selectAmount(paramAmt);
  } else {
    selectAmount(10); // Auto-select 10 DT
  }

  // 2. Initialize VanillaTilt for 3D Credit Card
  VanillaTilt.init(document.querySelector(".card-3d-wrapper"), {
    max: 15,
    speed: 400,
    glare: true,
    "max-glare": 0.4,
    scale: 1.05
  });

  // 3. GSAP Entry Animations
  const tl = gsap.timeline();
  tl.to('.gsap-header', { opacity: 1, duration: 0.8, ease: "power2.out" })
    .to('.gsap-card', { opacity: 1, y: 0, duration: 0.8, ease: "back.out(1.7)" }, "-=0.4")
    .to('.gsap-3d', { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.5)" }, "-=0.2")
    .fromTo('.gsap-content', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: "power2.out" }, "-=0.4");
});

// --- INPUT & SELECTION LOGIC ---
amountInput.addEventListener('input', handleInput);

function handleInput() {
  const val = parseInt(amountInput.value) || 0;
  
  // Dynamic width for input
  const chars = amountInput.value.length || 1;
  amountInput.style.width = Math.max(60, chars * 45) + 'px';
  
  if (amounts.includes(val)) {
    selectedAmount = val;
    suggestionBox.classList.add('hidden');
    btnPay.disabled = false;
    btnText.textContent = `Payer ${val} DT`;
    
    // Highlight list item silently
    document.querySelectorAll('.ios-sheet-item').forEach(n => {
      n.classList.toggle('selected', parseInt(n.textContent) === val);
    });
  } else {
    selectedAmount = null;
    btnPay.disabled = true;
    btnText.textContent = `Montant non disponible`;
    
    document.querySelectorAll('.ios-sheet-item').forEach(n => n.classList.remove('selected'));
    
    if (val > 0) {
      const closest = amounts.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
      suggestionBox.innerHTML = `Non disponible. <button class="suggestion-btn" onclick="selectAmount(${closest})">Choisir ${closest} DT</button>`;
      suggestionBox.classList.remove('hidden');
    } else {
      suggestionBox.classList.add('hidden');
    }
  }
}

// Global func for inline HTML onclicks
window.selectAmount = function(amt) {
  // "Odometer" roll animation for the input
  gsap.fromTo(amountInput, { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "back.out(1.5)" });
  
  amountInput.value = amt;
  handleInput();
  closeAmountSheet();
};

// --- SHEET LOGIC ---
btnOpenSheet.addEventListener('click', () => {
  amountSheetOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
});

function closeAmountSheet() {
  amountSheetOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

btnCloseSheet.addEventListener('click', closeAmountSheet);
amountSheetOverlay.addEventListener('click', e => {
  if (e.target === amountSheetOverlay) closeAmountSheet();
});


// --- SHARE LOGIC ---
btnShare.addEventListener('click', async () => {
  const val = parseInt(amountInput.value) || 10;
  // Use relative or absolute URL
  const shareUrl = `${window.location.origin}${window.location.pathname}?amount=${val}`;
  
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Tunistore Pay',
        text: `Payer ${val} DT via Tunistore Pay en toute sécurité.`,
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

// --- PAYMENT LOGIC ---
btnPay.addEventListener('click', async () => {
  if (!selectedAmount) return;

  // Loading State
  btnPay.disabled = true;
  btnText.classList.add('hidden');
  btnIcon.classList.add('hidden');
  btnLoader.classList.remove('hidden');
  spinnerAnim.play();
  errorMsg.classList.add('hidden');

  try {
    const res = await fetch(`/api/resolve-amount/${selectedAmount}`);
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
    if (data.status !== 'INITIATED' && data.status !== 'pending') throw new Error('Ce lien est expiré ou déjà payé.');

    // Reset Button
    spinnerAnim.stop();
    btnLoader.classList.add('hidden');
    btnText.classList.remove('hidden');
    btnIcon.classList.remove('hidden');
    btnPay.disabled = false;

    // Open Modal (Stripe style seamless overlay)
    openPayModal(data.formUrl);

  } catch (err) {
    // Reset Button
    spinnerAnim.stop();
    btnLoader.classList.add('hidden');
    btnText.classList.remove('hidden');
    btnIcon.classList.remove('hidden');
    btnPay.disabled = false;

    errorMsg.textContent = err.message;
    errorMsg.classList.remove('hidden');
    
    // Shake animation for error
    gsap.fromTo('.card', { x: -10 }, { x: 10, duration: 0.1, yoyo: true, repeat: 3, ease: "power1.inOut", onComplete: () => gsap.set('.card', {x: 0}) });
  }
});

function openPayModal(url) {
  modalUrl.textContent = new URL(url).hostname;
  modalExternal.href = url;
  payIframe.src = url;
  payModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

btnCloseModal.addEventListener('click', () => {
  payModal.classList.remove('active');
  payIframe.src = '';
  document.body.style.overflow = '';
});
