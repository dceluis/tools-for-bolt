// file: entrypoints/popup/App.tsx
import { useState } from 'react';
import { browser } from "wxt/browser";
import './App.css';

// Type for the detailed result from the background script
type ProcessResult = {
  step: 'inject' | 'save' | 'complete';
  success: boolean;
  error?: string;
};

export default function App() {
  const [status, setStatus] = useState<'idle' | 'working' | 'finished'>('idle');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ProcessResult | null>(null);

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
        // Handle cases where the message sending itself fails or background script has an issue
        setResult({ success: false, step: 'inject', error: resp?.error || 'An unknown background error occurred.' });
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setResult({ success: false, step: 'inject', error: `Communication error: ${errorMsg}` });
    } finally {
      setStatus('finished');
    }
  };

  const reset = () => {
    setStatus('idle');
    setResult(null);
  }

  const isWorking = status === 'working';
  // Show a reset button if the process is finished and was not successful
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
        // If injection failed, save step was never reached
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
      <h3 style={{ marginTop: 0 }}>Inject & Save</h3>
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
    </main>
  );
}
