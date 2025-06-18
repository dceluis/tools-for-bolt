import { useState, useEffect } from 'react';
import { browser } from "wxt/browser";
import { storage } from "#imports";
import './App.css';

/** Lazy-load the Claude tokenizer only when needed. */
let claudeTokPromise: Promise<{ encode: (txt: string, a?: any, b?: any) => number[] }> | null = null;
async function getClaudeTok() {
  if (!claudeTokPromise) {
    claudeTokPromise = import('@lenml/tokenizer-claude')
      .then(m => m.fromPreTrained());        // ← the documented factory
  }
  return claudeTokPromise;
}

// Type for the detailed result from the background script
type ProcessResult = {
  step: 'inject' | 'save' | 'complete';
  success: boolean;
  error?: string;
};

// Type for the ignore file write result
type IgnoreWriteResult = {
  ok: boolean;
  path?: string;
  error?: string;
  note?: string; // To provide extra context, like if the file was created.
};

export default function App() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [cleanupStatus, setCleanupStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [status, setStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ProcessResult | null>(null);

  // New state for the ignore file action
  const [ignoreStatus, setIgnoreStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [ignoreResult, setIgnoreResult] = useState<IgnoreWriteResult | null>(null);

  // State for the notification action
  const [notificationStatus, setNotificationStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [notificationResult, setNotificationResult] = useState<{ok: boolean, error?: string} | null>(null);

  // New state for the global token-count action
  const [tokStatus, setTokStatus]   = useState<'idle'|'working'|'finished'>('idle');
  const [tokResult, setTokResult]   = useState<{ok:boolean,total?:number,error?:string}|null>(null);

  const [tokIgnStatus, setTokIgnStatus]   = useState<'idle'|'working'|'finished'>('idle');
  const [tokIgnResult, setTokIgnResult]   = useState<{ok:boolean,total?:number,error?:string}|null>(null);

  /* ─── Alt-Estimator (Bolt heuristic) ───────────────────────────── */
  const [altTokStatus, setAltTokStatus] = useState<'idle'|'working'|'finished'>('idle');
  const [altTokResult, setAltTokResult] = useState<{ok:boolean,total?:number,error?:string}|null>(null);

  const [altTokAllStatus, setAltTokAllStatus] = useState<'idle'|'working'|'finished'>('idle');
  const [altTokAllResult, setAltTokAllResult] = useState<{ok:boolean,total?:number,error?:string}|null>(null);

  /** Bolt-style token estimator: bytes ÷ 3 × 0.8 */
  const boltEstimate = (str:string) => {
    const bytes = new TextEncoder().encode(str).byteLength;
    return Math.round(bytes / 3 * 0.8);
  };

  const handleBoltEstimate = async () => {
    console.log('[POPUP] Bolt-estimator button clicked');
    setAltTokStatus('working');
    setAltTokResult(null);
    try {
      /* honour .bolt/ignore so the result matches current workflow */
      const resp = await browser.runtime.sendMessage({ cmd:'tokenizeAllFilesRespectIgnore' });
      if (!resp?.ok) {
        setAltTokResult({ ok:false, error:resp?.error || 'Background error' });
      } else {
        const allText = resp.files.map((f:any) => f.content).join('\n\n');
        const total   = boltEstimate(allText);
        setAltTokResult({ ok:true, total });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAltTokResult({ ok:false, error:msg });
    } finally {
      setAltTokStatus('finished');
      setTimeout(() => setAltTokStatus('idle'), 5000);
    }
  };

  const handleBoltEstimateAll = async () => {
    console.log('[POPUP] Bolt-estimator (all files) button clicked');
    setAltTokAllStatus('working');
    setAltTokAllResult(null);
    try {
      const resp = await browser.runtime.sendMessage({ cmd:'tokenizeAllFiles' });
      if (!resp?.ok) {
        setAltTokAllResult({ ok:false, error:resp?.error || 'Background error' });
      } else {
        const allText = resp.files.map((f:any) => f.content).join('\n\n');
        const total   = boltEstimate(allText);
        setAltTokAllResult({ ok:true, total });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAltTokAllResult({ ok:false, error:msg });
    } finally {
      setAltTokAllStatus('finished');
      setTimeout(() => setAltTokAllStatus('idle'), 5000);
    }
  };

  const handleTokenizeAll = async () => {
    console.log('[POPUP] Tokenise button clicked');
    setTokStatus('working');
    setTokResult(null);
    try {
      const resp = await browser.runtime.sendMessage({ cmd: 'tokenizeAllFiles' });
      console.log('[POPUP] Response from BG:', resp);
      if (!resp?.ok) {
        setTokResult({ ok:false, error:resp?.error || 'Background error' });
      } else {
        const allText = resp.files.map((f:any) => f.content).join('\n\n');
        const tok     = await getClaudeTok();
        const total   = tok.encode(allText, { add_special_tokens: true }).length;
        console.log('[POPUP] Calculated tokens:', total);
        setTokResult({ ok:true, total });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[POPUP] tokenizeAllFiles error', msg);
      setTokResult({ ok:false, error:msg });
    } finally {
      setTokStatus('finished');
      setTimeout(() => setTokStatus('idle'), 5000);
    }
  };

  const handleTokenizeRespectIgnore = async () => {
    console.log('[POPUP] Tokenise-ignore button clicked');
    setTokIgnStatus('working');
    setTokIgnResult(null);
    try {
      const resp = await browser.runtime.sendMessage({ cmd: 'tokenizeAllFilesRespectIgnore' });
      console.log('[POPUP] Response from BG (ignore-aware):', resp);
      if (!resp?.ok) {
        setTokIgnResult({ ok: false, error: resp?.error || 'Background error' });
      } else {
        const allText = resp.files.map((f: any) => f.content).join('\n\n');
        const tok = await getClaudeTok();
        const total = tok.encode(allText, { add_special_tokens: true }).length;
        setTokIgnResult({ ok: true, total });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTokIgnResult({ ok: false, error: msg });
    } finally {
      setTokIgnStatus('finished');
      setTimeout(() => setTokIgnStatus('idle'), 5000);
    }
  };

  useEffect(() => {
    storage.getItem<boolean>('local:extensionEnabled').then((extensionEnabled) => {
      setIsEnabled(extensionEnabled !== false); // Default to true
    });
  }, []);

  const send = async () => {
    if (!text.trim() || status === 'working') return;
    setStatus('working');
    setResult(null);

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Could not find the active tab.');

      const resp = await browser.runtime.sendMessage({
        cmd: 'injectAndSave',
        text: text,
        tabId: tab.id
      });

      if (resp?.ok && resp.data) {
        setResult(resp.data);
        if (resp.data.success) setText('');
      } else {
        setResult({ success: false, step: 'inject', error: resp?.error || 'An unknown background error occurred.' });
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setResult({ success: false, step: 'inject', error: `Communication error: ${errorMsg}` });
    } finally {
      setStatus('finished');
    }
  };

  const handleToggleChange = async (newEnabledState: boolean) => {
    setIsEnabled(newEnabledState);
    await storage.setItem('local:extensionEnabled', newEnabledState);

    if (!newEnabledState) {
      // If disabling, run cleanup.
      setCleanupStatus('working');
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('Could not find active tab to run cleanup.');
        await browser.runtime.sendMessage({ cmd: 'cleanupIgnoreFile', tabId: tab.id });
      } catch (e) {
        console.error('Cleanup failed:', e);
      } finally {
        setCleanupStatus('finished');
        // Hide status message after a few seconds
        setTimeout(() => setCleanupStatus('idle'), 3000);
      }
    }
  };

  const handleOpenOptions = (e: React.MouseEvent) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  };

  const handleWriteIgnore = async () => {
    setIgnoreStatus('working');
    setIgnoreResult(null);

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Could not find active tab.');

      /* 🔄 Ask the background script to build a FULL ignore list */
      const response: IgnoreWriteResult = await browser.runtime.sendMessage({
        cmd   : 'createFullIgnoreFile',
        tabId : tab.id,
      });

      setIgnoreResult(response);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setIgnoreResult({ ok: false, error: `Communication error: ${errorMsg}` });
    } finally {
      setIgnoreStatus('finished');
    }
  };

  const handleShowNotification = async () => {
    console.log('[Popup] "Trigger Test Notification" button clicked.');
    setNotificationStatus('working');
    setNotificationResult(null);

    try {
      console.log('[Popup] Sending "showTestNotification" command to background script.');
      const response = await browser.runtime.sendMessage({
        cmd: 'showTestNotification',
      });

      console.log('[Popup] Received response from background:', response);

      if (response && response.ok) {
        setNotificationResult({ ok: true });
      } else {
        // This will now capture errors from the background, like "Could not find active tab"
        setNotificationResult({ ok: false, error: response?.error || 'An unknown error occurred.' });
      }
    } catch(e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[Popup] Error sending message:', e);
      setNotificationResult({ ok: false, error: `Communication error: ${errorMsg}` });
    } finally {
      setNotificationStatus('finished');
      // Hide status message after a few seconds
      setTimeout(() => setNotificationStatus('idle'), 5000);
    }
  };


  const reset = () => {
    setStatus('idle');
    setResult(null);
  }

  const isWorking = status === 'working';
  const showReset = status === 'finished' && (!result || !result.success);

  const renderStatus = () => {
    if (status === 'idle') return null;

    let injectionStatus = '⏳';
    let saveStatus = '...';

    if (status === 'working') {
      injectionStatus = '⚙️';
      saveStatus = '⏳';
    } else if (status === 'finished' && result) {
      const injectionDone = result.step === 'save' || result.step === 'complete';
      injectionStatus = injectionDone || result.success ? '✅' : '❌';

      if (injectionDone) {
        saveStatus = result.success ? '✅' : '❌';
      } else {
        saveStatus = '...';
      }
    }

    return (
      <div style={{ marginTop: '1rem' }}>
        <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>
          {status === 'working' && 'In Progress...'}
          {status === 'finished' && result?.success && <span style={{ color: 'lightgreen' }}>All steps complete!</span>}
          {status === 'finished' && !result?.success && <span style={{ color: 'salmon' }}>Process failed.</span>}
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, textAlign: 'left', fontSize: '0.9em' }}>
          <li>{injectionStatus} 1. Inject text</li>
          <li>{saveStatus} 2. Click save</li>
        </ul>
        {status === 'finished' && !result?.success && result?.error && (
          <p style={{ color: 'salmon', fontSize: '0.9em', marginTop: '0.5rem', wordBreak: 'break-word' }}>
            <strong>Reason:</strong> {result.error}
          </p>
        )}
      </div>
    );
  };

  return (
    <main style={{ padding: '1rem', width: 280, backgroundColor: '#242424', color: 'rgba(255, 255, 255, 0.87)' }}>
      <div className="toggle-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1em' }}>Bolt Assistant</h3>
          <a href="#" onClick={handleOpenOptions} title="Settings" className="settings-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{ display: 'block' }}>
              <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311a1.464 1.464 0 0 1-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
            </svg>
          </a>
        </div>
        <label className="switch">
          <input type="checkbox" checked={isEnabled} onChange={(e) => handleToggleChange(e.target.checked)} />
          <span className="slider round"></span>
        </label>
      </div>

      {isEnabled ? (
        <>
          <h4 className="section-header">Inject & Save</h4>
          <textarea
            rows={5}
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem' }}
            placeholder="Type text to inject..."
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={isWorking}
          />

          {showReset ? (
            <button style={{ width: '100%' }} onClick={reset}>Try Again</button>
          ) : (
            <button style={{ width: '100%' }} onClick={send} disabled={isWorking || !text.trim()}>
              {isWorking ? 'Working...' : 'Run'}
            </button>
          )}

          {renderStatus()}

          {/* --- Developer Tools Section --- */}
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #444' }}>
            <h4 className="section-header">Developer Actions</h4>
            <button
              style={{ width: '100%', marginBottom: '0.5rem' }}
              onClick={handleWriteIgnore}
              disabled={ignoreStatus === 'working'}
            >
              {ignoreStatus === 'working' ? 'Working...' : 'Write .bolt/ignore file'}
            </button>
            {ignoreStatus === 'finished' && ignoreResult && (
              <p style={{ color: ignoreResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', margin: 0, wordBreak: 'break-word', marginBottom: '0.75rem' }}>
                {ignoreResult.ok
                  ? `✅ Success! ${ignoreResult.note || 'File updated.'}`
                  : `❌ Error: ${ignoreResult.error}`
                }
              </p>
            )}

            <button
              style={{ width: '100%' }}
              onClick={handleShowNotification}
              disabled={notificationStatus === 'working'}
            >
              {notificationStatus === 'working' ? 'Sending...' : 'Trigger Test Notification'}
            </button>
            {notificationStatus === 'finished' && notificationResult && (
              <p style={{ color: notificationResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', marginTop: '0.5rem', wordBreak: 'break-word', minHeight: '1em' }}>
                {notificationResult.ok
                  ? `✅ Notification sent!`
                  : `❌ Error: ${notificationResult.error || 'Failed to send.'}`
                }
              </p>
            )}

            {/* ───────── Tokenise All Files ───────── */}
            <button
              style={{width:'100%', marginTop:'0.5rem' }}
              onClick={handleTokenizeAll}
              disabled={tokStatus === 'working'}
            >
              {tokStatus === 'working' ? 'Tokenising…' : 'Tokenise All Files'}
            </button>
            {tokStatus === 'finished' && tokResult && (
              <p style={{ color: tokResult.ok ? 'lightgreen':'salmon', fontSize:'0.9em',
                           marginTop:'0.5rem', wordBreak:'break-word', minHeight:'1em' }}>
                {tokResult.ok
                  ? `✅ Total tokens: ${tokResult.total}`
                  : `❌ Error: ${tokResult.error}`}
              </p>
            )}

            {/* ───────── Tokenise (respect .bolt/ignore) ───────── */}
            <button
              style={{ width: '100%', marginTop: '0.5rem' }}
              onClick={handleTokenizeRespectIgnore}
              disabled={tokIgnStatus === 'working'}
            >
              {tokIgnStatus === 'working' ? 'Tokenising…' : 'Tokenise (honour ignore)'}
            </button>
            {tokIgnStatus === 'finished' && tokIgnResult && (
              <p style={{
                color: tokIgnResult.ok ? 'lightgreen' : 'salmon',
                fontSize: '0.9em',
                marginTop: '0.5rem',
                wordBreak: 'break-word',
                minHeight: '1em',
              }}>
                {tokIgnResult.ok
                  ? `✅ Total tokens: ${tokIgnResult.total}`
                  : `❌ Error: ${tokIgnResult.error}`}
              </p>
            )}

            {/* ───────── Bolt-style Heuristic Estimate (Respect Ignore) ───────── */}
            <button
              style={{ width:'100%', marginTop:'0.5rem' }}
              onClick={handleBoltEstimate}
              disabled={altTokStatus === 'working'}
            >
              {altTokStatus === 'working' ? 'Estimating…' : 'Heuristic Token Estimate (Ignore)'}
            </button>
            {altTokStatus === 'finished' && altTokResult && (
              <p style={{
                color: altTokResult.ok ? 'lightgreen' : 'salmon',
                fontSize: '0.9em',
                marginTop: '0.5rem',
                wordBreak: 'break-word',
                minHeight: '1em',
              }}>
                {altTokResult.ok
                  ? `✅ Estimated tokens: ${altTokResult.total}`
                  : `❌ Error: ${altTokResult.error}`}
              </p>
            )}

            {/* ───────── Bolt-style Heuristic Estimate (All Files) ───────── */}
            <button
              style={{ width:'100%', marginTop:'0.5rem' }}
              onClick={handleBoltEstimateAll}
              disabled={altTokAllStatus === 'working'}
            >
              {altTokAllStatus === 'working' ? 'Estimating…' : 'Heuristic Token Estimate (All)'}
            </button>
            {altTokAllStatus === 'finished' && altTokAllResult && (
              <p style={{
                color: altTokAllResult.ok ? 'lightgreen' : 'salmon',
                fontSize: '0.9em',
                marginTop: '0.5rem',
                wordBreak: 'break-word',
                minHeight: '1em',
              }}>
                {altTokAllResult.ok
                  ? `✅ Estimated tokens: ${altTokAllResult.total}`
                  : `❌ Error: ${altTokAllResult.error}`}
              </p>
            )}
          </div>
        </>
      ) : (
        <p style={{ textAlign: 'center', color: '#888', marginTop: '2rem' }}>Extension is disabled. {cleanupStatus === 'working' && 'Cleaning up...'}</p>
      )}
    </main>
  );
}
