// file: entrypoints/popup/App.tsx
import { useState } from 'react';
import { browser } from "wxt/browser";
import './App.css';

export default function App() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [text, setText] = useState('');
  const [errorMessage, setErrorMessage] = useState(''); // State for detailed error messages

  const send = async () => {
    if (!text.trim() || status === 'sending') return;

    setStatus('sending');
    setErrorMessage(''); // Clear previous errors

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('Could not find the active tab.');
      }

      console.log(`[CM-Injector] sending to background for tab ${tab.id} →`, text);

      const resp = await browser.runtime.sendMessage({
        cmd: 'insertToCM',
        text: text,
        tabId: tab.id
      });

      if (resp?.ok) {
        setStatus('sent');
        setText(''); // Clear input on success
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        // Handle controlled errors returned from the background script
        setStatus('error');
        const errorText = resp?.error || 'An unknown error occurred in the background script.';
        setErrorMessage(errorText);
        console.error('[CM-Injector] Background script error:', errorText);
      }
    } catch (e) {
      // Handle communication errors (like the port closing)
      setStatus('error');
      const errorMsg = e instanceof Error ? e.message : String(e);
      setErrorMessage(errorMsg);
      console.error('[CM-Injector] Failed to send message:', e);
    }
  };

  const isSending = status === 'sending';

  return (
    <main style={{ padding: '1rem', width: 240 }}>
      <h3 style={{ marginTop: 0 }}>Insert into CodeMirror</h3>

      <textarea
        rows={4}
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem' }}
        placeholder="Type text…"
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={isSending}
      />

      <button style={{ width: '100%' }} onClick={send} disabled={isSending}>
        {isSending ? 'Injecting...' : 'Insert'}
      </button>

      {status === 'sent'  && <p style={{ color: 'green', marginTop: '1rem' }}>✅ Injected!</p>}
      {status === 'error' && (
        <p style={{ color: '#ff6b6b', marginTop: '1rem', fontSize: '0.9em', wordBreak: 'break-word' }}>
          ❌ **Injection Failed**<br />
          <span style={{ color: '#fab1a0' }}>{errorMessage}</span>
        </p>
      )}
    </main>
  );
}
