// file: entrypoints/background.ts
export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  // This function is injected to DO the work. It doesn't need to return anything.
  // It includes its own polling for maximum robustness.
  function injectCode(textToInsert: string) {
    const selector = '.cm-content';
    const maxAttempts = 20; // Try for 10 seconds
    let attempts = 0;

    const intervalId = setInterval(() => {
      attempts++;
      const wrapper = document.querySelector(selector) as any;

      if (wrapper?.cmView?.view) {
        clearInterval(intervalId);
        console.log(`[CM-Injector] ✅ Found element in target frame. Injecting...`);
        try {
          wrapper.cmView.view.dispatch({
            changes: {
              from: 0,
              to: wrapper.cmView.view.state.doc.length,
              insert: textToInsert,
            },
          });
        } catch (e) {
          console.error('[CM-Injector] Error during dispatch:', e);
        }
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        console.error(`[CM-Injector] ❌ Timed out waiting for element in target frame: "${selector}"`);
      }
    }, 500);
  }

  // This is a simple, SYNCHRONOUS function to FIND the editor.
  // Synchronous functions are much more reliable at returning values.
  function findEditorFrame() {
    return !!(document.querySelector('.cm-content') as any)?.cmView?.view;
  }

  // REWRITTEN LISTENER: Using the more robust `sendResponse` callback pattern.
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // We only care about this specific command.
    if (msg?.cmd !== 'insertToCM' || !msg.tabId) {
        // Early exit for irrelevant messages. It's important to not `return true` here.
        return;
    }

    const { tabId, text } = msg;
    console.log(`[CM-Injector] Request for tab ${tabId}. Probing for editor frame...`);

    // Using an IIFE (Immediately Invoked Function Expression) to use async/await
    // inside the listener while still being able to return `true` synchronously.
    (async () => {
      try {
        const probeResults = await browser.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          world: 'MAIN',
          func: findEditorFrame,
        });

        const targetFrame = probeResults.find(result => result.result === true);

        if (targetFrame) {
          console.log(`[CM-Injector] Editor found in frame ${targetFrame.frameId}. Dispatching injection.`);
          
          // Fire-and-forget the actual injection. We don't wait for it to complete.
          browser.scripting.executeScript({
            target: { tabId: tabId, frameIds: [targetFrame.frameId] },
            world: 'MAIN',
            func: injectCode,
            args: [text],
          }).catch(err => {
            console.error('[CM-Injector] Error during fire-and-forget script execution:', err);
          });

          // Immediately send the success response.
          sendResponse({ ok: true });
        } else {
          console.error('[CM-Injector] Probe failed. Editor not found in any frame.');
          sendResponse({ ok: false, error: 'The CodeMirror editor could not be found on this page.' });
        }
      } catch (e) {
        console.error('[CM-Injector] A fatal error occurred while trying to inject script:', e);
        const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
        sendResponse({ ok: false, error: `A browser scripting error occurred: ${errorMessage}` });
      }
    })();

    // This is the crucial part: We MUST return `true` from the top level of the
    // listener to signal that we will be calling `sendResponse` asynchronously.
    // This keeps the message channel open.
    return true;
  });
});
