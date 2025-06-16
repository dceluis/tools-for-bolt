import { useEffect, useState } from 'react';
import { storage } from '#imports';

/* --------- Constants --------- */
const GOOGLE_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-pro-preview-06-05',
  'gemini-2.5-flash-preview-05-20',
];
const OPENAI_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'o4-mini',
  'o4-mini-2025-04-16',
  'o3',
  'o3-2025-04-16',
];

/* --------- Component --------- */
export default function OptionApp() {
  /* state */
  const [provider, setProvider]       = useState<'google' | 'openai'>('google');
  const [googleKey, setGoogleKey]     = useState('');
  const [googleModel, setGoogleModel] = useState(GOOGLE_MODELS[0]);
  const [openaiKey, setOpenaiKey]     = useState('');
  const [openaiModel, setOpenaiModel] = useState(OPENAI_MODELS[0]);
  const [status, setStatus]           = useState('');
  const [showGKey, setShowGKey]       = useState(false);
  const [showOKey, setShowOKey]       = useState(false);

  /* load saved settings */
  useEffect(() => {
    (async () => {
      const [
        savedProvider,
        gKey,
        gModel,
        oKey,
        oModel,
      ] = await Promise.all([
        storage.getItem<string>('local:selectedProvider'),
        storage.getItem<string>('local:googleApiKey'),
        storage.getItem<string>('local:googleModel'),
        storage.getItem<string>('local:openaiApiKey'),
        storage.getItem<string>('local:openaiModel'),
      ]);
      setProvider((savedProvider as any) || 'google');
      setGoogleKey(gKey || '');
      setGoogleModel(gModel || GOOGLE_MODELS[0]);
      setOpenaiKey(oKey || '');
      setOpenaiModel(oModel || OPENAI_MODELS[0]);
    })();
  }, []);

  /* handlers */
  const save = async () => {
    await Promise.all([
      storage.setItem('local:selectedProvider', provider),
      storage.setItem('local:googleApiKey',     googleKey.trim()),
      storage.setItem('local:googleModel',      googleModel),
      storage.setItem('local:openaiApiKey',     openaiKey.trim()),
      storage.setItem('local:openaiModel',      openaiModel),
    ]);
    setStatus('Settings saved!');
    setTimeout(() => setStatus(''), 3000);
  };

  /* render */
  return (
    <>
      <h1>Extension Settings</h1>

      <div className="setting-group">
        <label htmlFor="provider-select">AI Provider</label>
        <select
          id="provider-select"
          value={provider}
          onChange={e => setProvider(e.target.value as any)}
        >
          <option value="google">Google Gemini</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>

      {/* Google Settings */}
      {provider === 'google' && (
        <div id="google-settings" className="provider-settings">
          <h2>Google Gemini Settings</h2>

          <div className="setting-group">
            <label htmlFor="google-api-key">API Key:</label>
            <div className="api-key-input-wrapper">
              <input
                type={showGKey ? 'text' : 'password'}
                id="google-api-key"
                placeholder="Enter your Google API key"
                value={googleKey}
                onChange={e => setGoogleKey(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowGKey(!showGKey)}
              >
                {showGKey ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          </div>

          <div className="setting-group">
            <label htmlFor="google-model-select">Model</label>
            <select
              id="google-model-select"
              value={googleModel}
              onChange={e => setGoogleModel(e.target.value)}
            >
              {GOOGLE_MODELS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* OpenAI Settings */}
      {provider === 'openai' && (
        <div id="openai-settings" className="provider-settings">
          <h2>OpenAI Settings</h2>

          <div className="setting-group">
            <label htmlFor="openai-api-key">API Key:</label>
            <div className="api-key-input-wrapper">
              <input
                type={showOKey ? 'text' : 'password'}
                id="openai-api-key"
                placeholder="Enter your OpenAI API key"
                value={openaiKey}
                onChange={e => setOpenaiKey(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowOKey(!showOKey)}
              >
                {showOKey ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          </div>

          <div className="setting-group">
            <label htmlFor="openai-model-select">Model</label>
            <select
              id="openai-model-select"
              value={openaiModel}
              onChange={e => setOpenaiModel(e.target.value)}
            >
              {OPENAI_MODELS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <button id="save-btn" onClick={save}>Save Settings</button>
      <p id="status">{status}</p>
    </>
  );
}
