// entrypoints/popup/App.tsx
import { useState, useEffect } from 'react';
import { browser } from 'wxt/browser';
import { storage } from '#imports';
import './App.css';

/** Lazy-load the Claude tokenizer only when needed. */
let claudeTokPromise: Promise<{ encode: (txt: string, a?: any, b?: any) => number[] }> | null = null;
async function getClaudeTok() {
  if (!claudeTokPromise) {
    claudeTokPromise = import('@lenml/tokenizer-claude').then(m => m.fromPreTrained());
  }
  return claudeTokPromise;
}

type ProcessResult = {
  step: 'inject' | 'save' | 'complete';
  success: boolean;
  error?: string;
};

/** Shared “cleanup” helper so both App and DevTools can call it */
async function cleanupIgnoreFile() {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) throw new Error('No active tab');
  const resp = await browser.runtime.sendMessage({ cmd: 'cleanupIgnoreFile', tabId: activeTab.id });
  if (!resp.ok) throw new Error(resp.error || 'Cleanup failed');
}

/** ─── DevTools panel ─────────────────────────────────────────────────── */
function DevTools() {
  const [ignoreStatus, setIgnoreStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [ignoreResult, setIgnoreResult] = useState<{ ok: boolean; note?: string; error?: string } | null>(null);

  const [notificationStatus, setNotificationStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [notificationResult, setNotificationResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const [tokStatus, setTokStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [tokResult, setTokResult] = useState<{ ok: boolean; total?: number; error?: string } | null>(null);

  const [tokIgnStatus, setTokIgnStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [tokIgnResult, setTokIgnResult] = useState<{ ok: boolean; total?: number; error?: string } | null>(null);

  const [altTokStatus, setAltTokStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [altTokResult, setAltTokResult] = useState<{ ok: boolean; total?: number; error?: string } | null>(null);

  const [altTokAllStatus, setAltTokAllStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [altTokAllResult, setAltTokAllResult] = useState<{ ok: boolean; total?: number; error?: string } | null>(null);

  const handleWriteIgnore = async () => {
    setIgnoreStatus('working');
    setIgnoreResult(null);
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) throw new Error('No active tab');
      const resp = await browser.runtime.sendMessage({ cmd: 'createFullIgnoreFile', tabId: activeTab.id });
      setIgnoreResult(resp);
    } catch (e) {
      setIgnoreResult({ ok: false, error: (e as Error).message });
    } finally {
      setIgnoreStatus('finished');
    }
  };

  const handleShowNotification = async () => {
    setNotificationStatus('working');
    setNotificationResult(null);
    try {
      // Demonstrate shared cleanup usage
      await cleanupIgnoreFile();
    } catch {
      // ignore
    }
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) throw new Error('No active tab');
      const resp = await browser.runtime.sendMessage({ cmd: 'showTestNotification' });
      setNotificationResult(resp);
    } catch (e) {
      setNotificationResult({ ok: false, error: (e as Error).message });
    } finally {
      setNotificationStatus('finished');
    }
  };

  const handleTokenizeAll = async () => {
    setTokStatus('working');
    setTokResult(null);
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) throw new Error('No active tab');
      const resp: any = await browser.runtime.sendMessage({ cmd: 'tokenizeAllFiles', tabId: activeTab.id });
      if (!resp.ok) throw new Error(resp.error);
      const tok = await getClaudeTok();
      const allText = resp.files.map((f: any) => f.content).join('\n\n');
      const total = tok.encode(allText, { add_special_tokens: true }).length;
      setTokResult({ ok: true, total });
    } catch (e) {
      setTokResult({ ok: false, error: (e as Error).message });
    } finally {
      setTokStatus('finished');
    }
  };

  const handleTokenizeRespectIgnore = async () => {
    setTokIgnStatus('working');
    setTokIgnResult(null);
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) throw new Error('No active tab');
      const resp: any = await browser.runtime.sendMessage({ cmd: 'tokenizeAllFilesRespectIgnore', tabId: activeTab.id });
      if (!resp.ok) throw new Error(resp.error);
      const tok = await getClaudeTok();
      const allText = resp.files.map((f: any) => f.content).join('\n\n');
      const total = tok.encode(allText, { add_special_tokens: true }).length;
      setTokIgnResult({ ok: true, total });
    } catch (e) {
      setTokIgnResult({ ok: false, error: (e as Error).message });
    } finally {
      setTokIgnStatus('finished');
    }
  };

  const boltEstimate = (str: string) => {
    const bytes = new TextEncoder().encode(str).byteLength;
    return Math.round((bytes / 3) * 0.8);
  };

  const handleBoltEstimate = async () => {
    setAltTokStatus('working');
    setAltTokResult(null);
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) throw new Error('No active tab');
      const resp: any = await browser.runtime.sendMessage({ cmd: 'tokenizeAllFilesRespectIgnore', tabId: activeTab.id });
      if (!resp.ok) throw new Error(resp.error);
      const allText = resp.files.map((f: any) => f.content).join('\n\n');
      setAltTokResult({ ok: true, total: boltEstimate(allText) });
    } catch (e) {
      setAltTokResult({ ok: false, error: (e as Error).message });
    } finally {
      setAltTokStatus('finished');
    }
  };

  const handleBoltEstimateAll = async () => {
    setAltTokAllStatus('working');
    setAltTokAllResult(null);
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) throw new Error('No active tab');
      const resp: any = await browser.runtime.sendMessage({ cmd: 'tokenizeAllFiles', tabId: activeTab.id });
      if (!resp.ok) throw new Error(resp.error);
      const allText = resp.files.map((f: any) => f.content).join('\n\n');
      setAltTokAllResult({ ok: true, total: boltEstimate(allText) });
    } catch (e) {
      setAltTokAllResult({ ok: false, error: (e as Error).message });
    } finally {
      setAltTokAllStatus('finished');
    }
  };

  return (
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
        <p style={{ color: ignoreResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', margin: 0 }}>
          {ignoreResult.ok ? `✅ Success: ${ignoreResult.note}` : `❌ ${ignoreResult.error}`}
        </p>
      )}

      <button
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={handleShowNotification}
        disabled={notificationStatus === 'working'}
      >
        {notificationStatus === 'working' ? 'Sending...' : 'Trigger Test Notification'}
      </button>
      {notificationStatus === 'finished' && notificationResult && (
        <p style={{ color: notificationResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', margin: 0 }}>
          {notificationResult.ok ? '✅ Notification sent!' : `❌ ${notificationResult.error}`}
        </p>
      )}

      <button
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={handleTokenizeAll}
        disabled={tokStatus === 'working'}
      >
        {tokStatus === 'working' ? 'Tokenising…' : 'Tokenise All Files'}
      </button>
      {tokStatus === 'finished' && tokResult && (
        <p style={{ color: tokResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', margin: 0 }}>
          {tokResult.ok ? `✅ Total tokens: ${tokResult.total}` : `❌ ${tokResult.error}`}
        </p>
      )}

      <button
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={handleTokenizeRespectIgnore}
        disabled={tokIgnStatus === 'working'}
      >
        {tokIgnStatus === 'working' ? 'Tokenising…' : 'Tokenise (honour ignore)'}
      </button>
      {tokIgnStatus === 'finished' && tokIgnResult && (
        <p style={{ color: tokIgnResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', margin: 0 }}>
          {tokIgnResult.ok ? `✅ Total tokens: ${tokIgnResult.total}` : `❌ ${tokIgnResult.error}`}
        </p>
      )}

      <button
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={handleBoltEstimate}
        disabled={altTokStatus === 'working'}
      >
        {altTokStatus === 'working' ? 'Estimating…' : 'Heuristic Token Estimate (Ignore)'}
      </button>
      {altTokStatus === 'finished' && altTokResult && (
        <p style={{ color: altTokResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', margin: 0 }}>
          {altTokResult.ok ? `✅ Estimated tokens: ${altTokResult.total}` : `❌ ${altTokResult.error}`}
        </p>
      )}

      <button
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={handleBoltEstimateAll}
        disabled={altTokAllStatus === 'working'}
      >
        {altTokAllStatus === 'working' ? 'Estimating…' : 'Heuristic Token Estimate (All)'}
      </button>
      {altTokAllStatus === 'finished' && altTokAllResult && (
        <p style={{ color: altTokAllResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', margin: 0 }}>
          {altTokAllResult.ok ? `✅ Estimated tokens: ${altTokAllResult.total}` : `❌ ${altTokAllResult.error}`}
        </p>
      )}
    </div>
  );
}

/** ─── Main Popup App ─────────────────────────────────────────────────── */
export default function App() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [cleanupStatus, setCleanupStatus] = useState<'idle' | 'working' | 'finished'>('idle');

  useEffect(() => {
    storage.getItem<boolean>('local:extensionEnabled').then(e => setIsEnabled(e !== false));
  }, []);

  const handleOpenOptions = (e: React.MouseEvent) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  };

  const handleToggleChange = async (newState: boolean) => {
    setIsEnabled(newState);
    await storage.setItem('local:extensionEnabled', newState);
    if (!newState) {
      setCleanupStatus('working');
      try {
        await cleanupIgnoreFile();
      } catch {
        // ignore
      } finally {
        setCleanupStatus('finished');
        setTimeout(() => setCleanupStatus('idle'), 3000);
      }
    }
  };

  return (
    <main style={{ padding: '1rem', width: 280, backgroundColor: '#242424', color: 'rgba(255,255,255,0.87)' }}>
      <div className="toggle-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1em' }}>Bolt Assistant</h3>
          <a href="#" onClick={handleOpenOptions} title="Settings" style={{ color: '#aaa' }}>
            ⚙️
          </a>
        </div>
        <label className="switch">
          <input type="checkbox" checked={isEnabled} onChange={e => handleToggleChange(e.target.checked)} />
          <span className="slider round"></span>
        </label>
      </div>

      {isEnabled ? (
        <>
          {import.meta.env.DEV && <DevTools />}
        </>
      ) : (
        <p style={{ textAlign: 'center', color: '#888', marginTop: '2rem' }}>
          Extension is disabled. {cleanupStatus === 'working' && 'Cleaning up...'}
        </p>
      )}
    </main>
  );
}
