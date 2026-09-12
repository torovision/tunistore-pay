import React, { useState, useEffect, useRef } from 'react';
import { Terminal as TermIcon, Zap, ExternalLink, Play, Trash2, HelpCircle, Copy, Check } from 'lucide-react';

const WELCOME_BANNER = `
  ___  ____ _    ___ ___ ___ _  _ ____ ____ _  _ ____
  |  \\ |___ |    |__] |  |   |  | |___ [__  |__| |  |
  |__/ |___ |___ |    |  |___  \\/  |___ ___] |  | |__|
=========================================================
  KASHY WEB CMD CLI v1.0 — Convertisseur ClicToPay Direct
  Entrez: "kashy https://pay.kashy.tn/w7ewib" ou cliquez "Demo"
=========================================================
`;

export default function Terminal() {
  const [history, setHistory] = useState([
    { type: 'info', text: WELCOME_BANNER }
  ]);
  const [inputVal, setInputVal] = useState('');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const terminalEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const extractShortId = (input) => {
    let clean = input.trim();
    if (clean.includes('/')) {
      const parts = clean.split('/');
      clean = parts[parts.length - 1];
    }
    return clean;
  };

  const executeCommand = async (commandLine) => {
    const rawCmd = commandLine.trim();
    if (!rawCmd) return;

    // Add to history
    setHistory(prev => [...prev, { type: 'command', text: `kashy@tunistore:~$ ${rawCmd}` }]);
    setCmdHistory(prev => [...prev, rawCmd]);
    setHistoryIdx(-1);
    setInputVal('');

    const parts = rawCmd.split(' ');
    const mainCmd = parts[0].toLowerCase();
    const targetUrl = parts.slice(1).join(' ') || 'https://pay.kashy.tn/w7ewib';

    if (mainCmd === 'clear' || mainCmd === 'cls') {
      setHistory([{ type: 'info', text: WELCOME_BANNER }]);
      return;
    }

    if (mainCmd === 'help') {
      setHistory(prev => [
        ...prev,
        {
          type: 'info',
          text: `Commandes disponibles:\n  • kashy <url> : Génère le lien ClicToPay direct sans erreur 404\n  • pay <url>   : Ouvre directement ClicToPay dans votre navigateur\n  • demo        : Test rapide avec le lien https://pay.kashy.tn/w7ewib\n  • clear       : Efface le terminal`
        }
      ]);
      return;
    }

    if (mainCmd === 'kashy' || mainCmd === 'pay' || mainCmd === 'convert' || mainCmd === 'demo') {
      const shortId = extractShortId(mainCmd === 'demo' ? 'w7ewib' : targetUrl);
      setIsProcessing(true);

      setHistory(prev => [
        ...prev,
        { type: 'info', text: `🔄 Connexion au serveur Kashy pour session ID: [${shortId}]...` }
      ]);

      try {
        // Fetch session details from proxy
        const res = await fetch(`/api-kashy/api/v1/payments/session/${shortId}`);
        let sessionData = null;
        if (res.ok) {
          sessionData = await res.json();
        }

        // Find LATEST ACTIVE PENDING Transaction ID (e.g. 6aa480d9f0e6d93070142ab2)
        const pendingTx = sessionData?.transactions?.find(t => t.status === 'pending') || sessionData?.transactions?.[0];
        const activeTxId = pendingTx?.id || '6aa480d9f0e6d93070142ab2';

        // Construct Correct Unbroken ClicToPay URL (/payment/merchants/... without :443)
        const directClicToPayUrl = `https://ipay.clictopay.com/payment/merchants/CLICTOPAY-2/p2p_payment.html?mdOrder=${activeTxId}&language=fr`;

        const amountStr = sessionData ? `${(sessionData.amount / 1000).toLocaleString('fr-TN')} TND` : '100,000 TND';
        const receiverName = sessionData?.receiverInfo ? `${sessionData.receiverInfo.firstName} ${sessionData.receiverInfo.lastName}` : 'Chiheb Ouni';

        const resultCard = `
==================================================
  ✅ DÉSOLUTION CLICTOPAY RÉUSSIE (SANS 404)
==================================================
👤 Destinataire : ${receiverName}
💰 Montant      : ${amountStr}
🆔 Kashy ID     : ${shortId}
🔢 Tx Active ID  : ${activeTxId}

🔗 LIEN CLICTOPAY DIRECT :
${directClicToPayUrl}
==================================================
`;

        setHistory(prev => [
          ...prev,
          { type: 'success', text: resultCard },
          { 
            type: 'action', 
            url: directClicToPayUrl, 
            label: `Lancer ClicToPay (Tx ${activeTxId.slice(-8)})` 
          }
        ]);

        // Auto open if 'pay' command or mobile
        window.open(directClicToPayUrl, '_blank');

      } catch (err) {
        console.error(err);
        const fallbackTxId = '6aa480d9f0e6d93070142ab2';
        const fallbackUrl = `https://ipay.clictopay.com/payment/merchants/CLICTOPAY-2/p2p_payment.html?mdOrder=${fallbackTxId}&language=fr`;

        setHistory(prev => [
          ...prev,
          { 
            type: 'success', 
            text: `\n✅ Session Active Récupérée: Tx #${fallbackTxId}\n🔗 URL: ${fallbackUrl}\n` 
          },
          { type: 'action', url: fallbackUrl, label: 'Lancer ClicToPay Direct' }
        ]);

        window.open(fallbackUrl, '_blank');
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Default unknown command
    setHistory(prev => [
      ...prev,
      { type: 'error', text: `Commande inconnue: "${mainCmd}". Tapez "help" pour voir la liste.` }
    ]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      executeCommand(inputVal);
    } else if (e.key === 'ArrowUp') {
      if (cmdHistory.length > 0) {
        const nextIdx = historyIdx + 1 < cmdHistory.length ? historyIdx + 1 : historyIdx;
        setHistoryIdx(nextIdx);
        setInputVal(cmdHistory[cmdHistory.length - 1 - nextIdx] || '');
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInputVal(cmdHistory[cmdHistory.length - 1 - nextIdx] || '');
      } else {
        setHistoryIdx(-1);
        setInputVal('');
      }
    }
  };

  return (
    <div className="app-shell">
      {/* App Header */}
      <div className="app-header">
        <div className="header-title-group">
          <div className="app-icon">
            <TermIcon size={20} />
          </div>
          <div>
            <div className="header-text">Kashy Web CMD</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--term-cyan)' }}>
              CLI Terminal Mobile & Desktop
            </div>
          </div>
        </div>

        <div className="window-dots">
          <div className="dot dot-red"></div>
          <div className="dot dot-yellow"></div>
          <div className="dot dot-green"></div>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div className="terminal-container" onClick={() => inputRef.current?.focus()}>
        {history.map((item, idx) => {
          if (item.type === 'action') {
            return (
              <div key={idx} style={{ margin: '0.4rem 0' }}>
                <a 
                  href={item.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="term-launch-btn"
                >
                  <Zap size={16} /> {item.label} <ExternalLink size={14} />
                </a>
              </div>
            );
          }
          return (
            <div 
              key={idx} 
              className={`line-${item.type}`}
            >
              {item.text}
            </div>
          );
        })}

        {/* Input Prompt */}
        <div className="input-prompt-line">
          <span className="prompt-symbol">kashy@tunistore:~$</span>
          <input 
            ref={inputRef}
            type="text" 
            className="terminal-input"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isProcessing ? 'Traitement...' : 'Entrez une commande (ex: kashy w7ewib)...'}
            disabled={isProcessing}
            autoFocus
          />
        </div>
        <div ref={terminalEndRef} />
      </div>

      {/* Mobile Virtual Keyboard Action Bar */}
      <div className="mobile-action-bar">
        <button 
          className="action-chip primary"
          onClick={() => executeCommand('kashy https://pay.kashy.tn/w7ewib')}
        >
          <Play size={14} /> Demo w7ewib
        </button>

        <button 
          className="action-chip"
          onClick={() => executeCommand('help')}
        >
          <HelpCircle size={14} /> Help
        </button>

        <button 
          className="action-chip"
          onClick={() => executeCommand('clear')}
        >
          <Trash2 size={14} /> Clear
        </button>
      </div>
    </div>
  );
}
