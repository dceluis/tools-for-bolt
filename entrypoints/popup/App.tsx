import { useState, useEffect } from 'react';
import { browser } from "wxt/browser";
import { storage } from "#imports";
import './App.css';

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
  const handleWriteIgnore = async () => {
    setIgnoreStatus('working');
    setIgnoreResult(null);

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Could not find active tab.');

      const defaultContent = [
        '# Common files to ignore',
        'node_modules',
        '.wxt',
        '.output',
        'dist',
        '*.log',
      ].join('\n');

      const response: IgnoreWriteResult = await browser.runtime.sendMessage({
        cmd: 'createOrUpdateIgnoreFile',
        tabId: tab.id,
        content: defaultContent,
      });

      setIgnoreResult(response);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setIgnoreResult({ ok: false, error: `Communication error: ${errorMsg}` });
    } finally {
      setIgnoreStatus('finished');
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
        <h3 style={{ margin: 0, fontSize: '1.1em' }}>Bolt Assistant</h3>
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
              <p style={{ color: ignoreResult.ok ? 'lightgreen' : 'salmon', fontSize: '0.9em', margin: 0, wordBreak: 'break-word' }}>
                {ignoreResult.ok
                  ? `✅ Success! ${ignoreResult.note || 'File updated.'}`
                  : `❌ Error: ${ignoreResult.error}`
                }
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
