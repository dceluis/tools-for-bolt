// file: entrypoints/background.ts
export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  /**
   * This function is injected to perform the entire multi-step process.
   * It's async and returns a detailed result object.
   */
  async function injectAndSave(textToInsert: string) {
    /**
     * Helper to poll for an element and return a Promise.
     * This is crucial for waiting for UI elements to appear.
     */
    function waitForElement<T>(findFn: () => T | null, timeout = 5000): Promise<T> {
      return new Promise((resolve, reject) => {
        const interval = 250;
        const maxAttempts = timeout / interval;
        let attempts = 0;

        const poll = () => {
          const element = findFn();
          if (element) {
            resolve(element);
          } else {
            attempts++;
            if (attempts < maxAttempts) {
              setTimeout(poll, interval);
            } else {
              reject(new Error(`Timed out waiting for element after ${timeout}ms.`));
            }
          }
        };
        poll();
      });
    }

    // --- Step 1: Find and inject into editor ---
    try {
      const editorWrapper = await waitForElement(() => {
        const el = document.querySelector('.cm-content') as any;
        // Ensure the CodeMirror view instance is attached
        return el?.cmView?.view ? el : null;
      });

      console.log('[Injector] ✅ Step 1: Found editor. Injecting text...');
      editorWrapper.cmView.view.dispatch({
        changes: {
          from: 0,
          to: editorWrapper.cmView.view.state.doc.length,
          insert: textToInsert,
        },
        // --- THIS IS THE FIX ---
        // Tell CodeMirror this is a user input event, which will trigger
        // the host application's listeners correctly.
        userEvent: 'input',
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Injector] ❌ Step 1 failed:', errorMessage);
      return { step: 'inject', success: false, error: 'Could not find CodeMirror editor.' };
    }

    // --- Step 2: Find and click save button ---
    try {
      const saveButton = await waitForElement(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        // Find the save button, which should now be visible and enabled
        const btn = buttons.find(button =>
          button.textContent?.trim().includes('Save') &&
          button.querySelector('.i-ph\\:floppy-disk-duotone') &&
          !button.disabled
        );
        return btn;
      }, 5000); // Keep the timeout for finding the button

      console.log('[Injector] ✅ Step 2: Found save button. Clicking...');
      saveButton.click();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Injector] ❌ Step 2 failed:', errorMessage);
      return { step: 'save', success: false, error: 'Could not find the save button after injection.' };
    }

    // --- Final Step: Success ---
    console.log('[Injector] ✅ Process complete.');
    return { step: 'complete', success: true };
  }

  // A simple, synchronous function to quickly find if the editor frame exists.
  function findEditorFrame() {
    return !!(document.querySelector('.cm-content') as any)?.cmView?.view;
  }

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Renamed command for clarity
    if (msg?.cmd !== 'injectAndSave' || !msg.tabId) {
      return;
    }

    const { tabId, text } = msg;
    console.log(`[Background] Received 'injectAndSave' request for tab ${tabId}.`);

    (async () => {
      try {
        // Step 1: Probe all frames to find the one with the editor.
        const probeResults = await browser.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: findEditorFrame,
        });

        const targetFrame = probeResults.find(result => result.result === true);

        if (!targetFrame) {
          console.error('[Background] Probe failed. Editor not found in any frame.');
          sendResponse({ ok: false, data: { success: false, step: 'inject', error: 'The CodeMirror editor could not be found on this page.' } });
          return;
        }

        console.log(`[Background] Editor found in frame ${targetFrame.frameId}. Executing script.`);

        // Step 2: Execute the full script in the target frame and AWAIT its detailed result.
        const [executionResult] = await browser.scripting.executeScript({
          target: { tabId, frameIds: [targetFrame.frameId] },
          world: 'MAIN',
          func: injectAndSave,
          args: [text],
        });

        console.log('[Background] Script execution finished. Result:', executionResult.result);

        // Step 3: Send the detailed result back to the popup.
        sendResponse({ ok: true, data: executionResult.result });

      } catch (e) {
        console.error('[Background] A fatal error occurred:', e);
        const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
        sendResponse({ ok: false, data: { success: false, step: 'inject', error: `A browser scripting error occurred: ${errorMessage}` } });
      }
    })();

    // Return true to indicate that sendResponse will be called asynchronously.
    return true;
  });
});
