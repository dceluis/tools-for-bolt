// file: entrypoints/background.ts

/**
 * The single, powerful injected script that handles the entire file operation.
 * It acts like a user: finds the file, clicks it, and edits it.
 * If the file doesn't exist, it uses the AI chat as a fallback to create it,
 * as this is the only reliable file-creation method in the app.
 */
async function createOrUpdateIgnoreFile(content: string) {
  const filePath = '/home/project/.bolt/ignore';
  const fileName = '.ignore';
  const folderName = '.bolt';
  
  // A robust helper to wait for elements to appear and be ready.
  function waitForElement<T extends Element>(selector: string, timeout = 10000, root: Document | Element = document): Promise<T> {
    return new Promise((resolve, reject) => {
      const interval = 250;
      const maxAttempts = timeout / interval;
      let attempts = 0;

      const poll = () => {
        const element = root.querySelector(selector) as T | null;
        if (element && !(element as HTMLButtonElement).disabled) {
          resolve(element);
          return;
        }
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, interval);
        } else {
          reject(new Error(`Timed out waiting for selector: "${selector}"`));
        }
      };
      poll();
    });
  }

  // A helper to parse the file tree and find a specific file element.
  function findFileElementInTree(targetPath: string): HTMLElement | null {
    const fileButtons = document.querySelectorAll<HTMLElement>('button.flex.items-center.w-full');
    let currentPath = '/home/project';
    let lastDepth = -1;

    for (const button of fileButtons) {
      const nameElement = button.querySelector<HTMLElement>('.truncate.w-full.text-left');
      if (!nameElement) continue;

      const name = nameElement.innerText.trim();
      const padding = parseInt(button.style.paddingLeft || '0', 10);
      const depth = Math.round((padding - 6) / 8); // Based on file tree styles

      if (depth > lastDepth) {
        // Entered a subfolder
      } else if (depth < lastDepth) {
        // Went up one or more levels
        const levelsUp = lastDepth - depth;
        currentPath = currentPath.split('/').slice(0, -(levelsUp + 1)).join('/');
      }
      
      const isFolder = !!button.querySelector('.i-ph\\:caret-down, .i-ph\\:caret-right');
      const itemPath = `${currentPath}/${name}`;
      
      if (itemPath === targetPath) {
        return button;
      }
      
      if (isFolder) {
        currentPath = itemPath;
      }
      lastDepth = depth;
    }
    return null;
  }

  try {
    // --- PATH A: Try to find and click the file if it exists ---
    console.log('[DevAction] Searching for file in tree:', filePath);
    const fileElement = findFileElementInTree(filePath);

    if (fileElement) {
      console.log('[DevAction] File found. Clicking to open...');
      fileElement.click();

      console.log('[DevAction] Waiting for editor to load...');
      const editorWrapper = await waitForElement<HTMLElement>('.cm-content');
      const cmView = (editorWrapper as any)?.cmView?.view;
      if (!cmView) throw new Error('CodeMirror instance not found after opening file.');

      const currentContent = cmView.state.doc.toString();
      if (currentContent === content) {
        console.log('[DevAction] File content is already up to date. No changes needed.');
        return { ok: true, path: filePath, note: 'File content already up to date.' };
      }

      console.log('[DevAction] Editor loaded. Injecting new content...');
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: content },
        userEvent: 'input',
      });

      console.log('[DevAction] Waiting for save button to be enabled...');
      const saveButton = await waitForElement<HTMLButtonElement>('button:not(:disabled) .i-ph\\:floppy-disk-duotone');
      
      console.log('[DevAction] Clicking save...');
      saveButton.parentElement?.click();

      return { ok: true, path: filePath, note: 'File updated successfully.' };
    }

  } catch (e: any) {
    console.error('[DevAction] Operation failed:', e);
    return { ok: false, error: e.message || 'An unknown UI automation error occurred.' };
  }
}


export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  async function injectAndSave(textToInsert: string) {
    function waitForElement<T>(findFn: () => T | null, timeout = 5000): Promise<T> {
      return new Promise((resolve, reject) => {
        const interval = 250;
        const maxAttempts = timeout / interval;
        let attempts = 0;
        const poll = () => {
          const element = findFn();
          if (element) { resolve(element); } 
          else {
            attempts++;
            if (attempts < maxAttempts) { setTimeout(poll, interval); } 
            else { reject(new Error(`Timed out waiting for element after ${timeout}ms.`)); }
          }
        };
        poll();
      });
    }
    try {
      const editorWrapper = await waitForElement(() => {
        const el = document.querySelector('.cm-content') as any;
        return el?.cmView?.view ? el : null;
      });
      editorWrapper.cmView.view.dispatch({ changes: { from: 0, to: editorWrapper.cmView.view.state.doc.length, insert: textToInsert }, userEvent: 'input' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { step: 'inject', success: false, error: 'Could not find CodeMirror editor.' };
    }
    try {
      const saveButton = await waitForElement(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(button => button.textContent?.trim().includes('Save') && button.querySelector('.i-ph\\:floppy-disk-duotone') && !button.disabled);
      }, 5000);
      saveButton.click();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { step: 'save', success: false, error: 'Could not find the save button after injection.' };
    }
    return { step: 'complete', success: true };
  }

  function findEditorFrame() {
    return !!(document.querySelector('.cm-content') as any)?.cmView?.view;
  }

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.cmd || !msg.tabId) {
      return false;
    }

    switch (msg.cmd) {
      case 'injectAndSave':
        (async () => {
          try {
            const probeResults = await browser.scripting.executeScript({ target: { tabId: msg.tabId, allFrames: true }, world: 'MAIN', func: findEditorFrame });
            const targetFrame = probeResults.find(r => r.result === true);
            if (!targetFrame) {
              sendResponse({ ok: false, data: { success: false, step: 'inject', error: 'The CodeMirror editor could not be found.' } });
              return;
            }
            const [result] = await browser.scripting.executeScript({ target: { tabId: msg.tabId, frameIds: [targetFrame.frameId] }, world: 'MAIN', func: injectAndSave, args: [msg.text] });
            sendResponse({ ok: true, data: result.result });
          } catch (e) {
            sendResponse({ ok: false, data: { success: false, step: 'inject', error: (e as Error).message } });
          }
        })();
        return true;

      case 'createOrUpdateIgnoreFile':
        (async () => {
          try {
            const [result] = await browser.scripting.executeScript({
              target: { tabId: msg.tabId },
              world: 'MAIN',
              func: createOrUpdateIgnoreFile,
              args: [msg.content],
            });
            sendResponse(result.result);
          } catch (e) {
            sendResponse({ ok: false, error: (e as Error).message });
          }
        })();
        return true;

      default:
        return false;
    }
  });
});
