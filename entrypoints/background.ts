// file: entrypoints/background.ts
import { storage } from '#imports';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

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

  /* ───── Section-ownership constants ───────────────────────────────────── */
  const GENERATED_START = '# ==== BOLT-ASSISTANT AUTO-GENERATED START ====';
  const GENERATED_END   = '# ==== BOLT-ASSISTANT AUTO-GENERATED END ====';
  const GENERATED_WARN  = '# WARNING: This section is managed automatically by Bolt Assistant – any manual edits here will be overwritten.';

  /* ------------------------------------------------------------------ *
   *  Make sure the “Code” tab is selected and the `.bolt` folder open   *
   * ------------------------------------------------------------------ */
  async function ensureWorkbenchReady() {
    /* 1️⃣ activate Code tab so the tree is rendered */
    const headerSel = '.z-workbench .flex.items-center.px-3.py-2.border-b';
    const header    = document.querySelector<HTMLElement>(headerSel);
    if (header) {
      const codeTab = Array.from(header.querySelectorAll('button'))
        .find(b => b.textContent?.trim().toLowerCase() === 'code');
      if (codeTab && codeTab.getAttribute('aria-pressed') !== 'true') {
        codeTab.click();
        await new Promise(r => setTimeout(r, 300));
      }
    }

    /* 2️⃣ expand `.bolt/` if it’s still collapsed */
    const treeRoot = document
      .querySelector('button.flex.items-center.w-full')
      ?.closest('.flex.flex-col');
    if (!treeRoot) return;

    const collapsedBolt = Array.from(
      treeRoot.querySelectorAll<HTMLElement>(
        'button.flex.items-center.w-full:has(.i-ph\\:caret-right)',
      ),
    ).find(btn =>
      btn
        .querySelector<HTMLElement>('.truncate.w-full.text-left')
        ?.textContent?.trim() === '.bolt',
    );
    if (collapsedBolt) {
      collapsedBolt.click();
      await new Promise(r => setTimeout(r, 250));
    }
  }

  /** Merge or remove the generated section, returning updated text + flag. */
  function mergeGeneratedSection(
    original: string,
    generatedBody: string,          // “*” → cleanup
  ): { merged: string; changed: boolean } {
    const sectionRE = new RegExp(`${GENERATED_START}[\\s\\S]*?${GENERATED_END}`, 'm');

    /* ── Cleanup: strip section if it exists ────────────────────────────── */
    if (generatedBody === '*') {
      if (!sectionRE.test(original)) return { merged: original, changed: false };
      const cleaned = original
        .replace(sectionRE, '')
        .replace(/\n{3,}/g, '\n\n')         // collapse extra blank lines
        .trimStart();
      return { merged: cleaned, changed: true };
    }

    /* ── Compose replacement block ──────────────────────────────────────── */
    const newBlock = [
      GENERATED_START,
      GENERATED_WARN,
      generatedBody.trim(),
      GENERATED_END,
    ].join('\n');

    const merged = sectionRE.test(original)
      ? original.replace(sectionRE, newBlock)             // replace existing
      : (original.trimEnd() ? original + '\n\n' : '') +   // append if absent
        newBlock + '\n';

    return { merged, changed: merged !== original };
  }

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
    await ensureWorkbenchReady();
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
      /* ── Merge our section (or clean up) ──────────────────────────────── */
      const { merged: newContent, changed } = mergeGeneratedSection(currentContent, content);

      if (!changed) {
        console.log('[DevAction] Generated section already up-to-date – nothing to do.');
        return { ok: true, path: filePath, note: 'File content already up to date.' };
      }

      console.log('[DevAction] Editor loaded. Injecting new content...');
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: newContent },
        userEvent: 'input',
      });

      console.log('[DevAction] Waiting for save button to be enabled...');
      const saveButton = await waitForElement<HTMLButtonElement>('button:not(:disabled) .i-ph\\:floppy-disk-duotone');
      
      console.log('[DevAction] Clicking save...');
      saveButton.parentElement?.click();

      return { ok: true, path: filePath, note: changed ? 'Generated section updated.' : 'No changes needed.' };
    } else {
      // File not found. Special handling for cleanup.
      if (content === '*') {
        console.log('[DevAction] .bolt/ignore not found. No cleanup needed.');
        return { ok: true, path: filePath, note: 'File did not exist, no cleanup needed.' };
      }
      // For any other content, not finding the file is an error because this script cannot create files.
      return { ok: false, error: 'File .bolt/ignore not found. Cannot perform action.' };
    }

  } catch (e: any) {
    console.error('[DevAction] Operation failed:', e);
    return { ok: false, error: e.message || 'An unknown UI automation error occurred.' };
  }
}


export default defineBackground(() => {
  console.log('[Background] Service worker started.');

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
    // Determine the sender for logging purposes.
    const senderCtx = sender.tab ? `tab ${sender.tab.id}` : 'popup or other context';
    console.log(`[Background] Received command '${msg.cmd}' from ${senderCtx}.`);

    if (!msg || !msg.cmd) {
      console.warn('[Background] Ignoring invalid message:', msg);
      return false;
    }

    switch (msg.cmd) {
      case 'tokenizeAllFiles':
      (async () => {
        console.log('[BG] tokenizeAllFiles → received');

        /* 1️⃣  identify target tab */
        let tabId: number | undefined = sender.tab?.id ?? msg.tabId;
        if (!tabId) {
          const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
          tabId = activeTab?.id;
        }
        if (!tabId) {
          sendResponse({ ok:false, error:'Could not identify target tab.' });
          return;
        }

        /* 2️⃣  run the **direct-import** strategy inside the page */
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          world : 'MAIN',
          func  : () => {
            return (async () => {
              try {
                /* ── locate & import the projects chunk ───────────────── */
                const link = document.querySelector('link[rel="modulepreload"][href*="projects-"]');
                if (!link) throw new Error('projects bundle link not found');
                const href = link.getAttribute('href')!;
                const url  = new URL(href, location.origin).href;
                const mod  = await import(/* @vite-ignore */ url);

                /* ── find the store that holds files ─────────────────── */
                const store = Object.values(mod).find((x:any) => x?.files?.get);
                if (!store) throw new Error('files store export not detected');
                const fileMap: Record<string, any> = store.files.get();

                /* ── assemble markdown snapshot ───────────────────────── */
                const md: string[] = ['# Files\\n'];
                for (const [path, entry] of Object.entries(fileMap)) {
                  md.push(
                    `## File: ${path}\\n\\\`\\\`\\\`\\n${entry?.content ?? ''}\\n\\\`\\\`\\\`\\n\\n---\\n`
                  );
                }

                return {
                  ok       : true,
                  markdown : md.join('\\n'),
                  files    : Object.entries(fileMap).map(([path, entry]) => ({
                    path,
                    content: entry?.content ?? '',
                  })),
                };
              } catch (e:any) {
                return { ok:false, error:e.message || String(e) };
              }
            })();
          },
        });

        /* 3️⃣  relay the page-side result back to the popup */
        sendResponse(result?.result ?? { ok:false, error:'Injection failed' });
      })();
      return true;

      case 'injectAndSave':
        (async () => {
          /* ── 1️⃣  Resolve target tab (popup → no sender.tab) ───────────────── */
          let tabId: number | undefined = sender.tab?.id ?? msg.tabId;
          if (!tabId) {
            const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
            tabId = activeTab?.id;
          }

          if (!tabId) {
            sendResponse({ ok: false, error: 'Could not identify target tab.' });
            return;
          }

          try {
            const probeResults = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: findEditorFrame });
            const targetFrame = probeResults.find(r => r.result === true);
            if (!targetFrame) {
              sendResponse({ ok: false, data: { success: false, step: 'inject', error: 'The CodeMirror editor could not be found.' } });
              return;
            }
            const [result] = await browser.scripting.executeScript({ target: { tabId, frameIds: [targetFrame.frameId] }, world: 'MAIN', func: injectAndSave, args: [msg.text] });
            sendResponse({ ok: true, data: result.result });
          } catch (e) {
            sendResponse({ ok: false, data: { success: false, step: 'inject', error: (e as Error).message } });
          }
        })();
        return true; // Keep the message channel open for the async response.

      case 'createOrUpdateIgnoreFile':
      case 'cleanupIgnoreFile':
        (async () => {
          try {
            // 1️⃣  Determine the correct target tab (popup calls have no sender.tab).
            let tabId: number | undefined = sender.tab?.id ?? msg.tabId;
            if (!tabId) {
              const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
              tabId = activeTab?.id;
            }

            if (!tabId) {
              sendResponse({ ok: false, error: 'Could not identify target tab.' });
              return;
            }

            // 2️⃣  Decide whether we’re writing or cleaning up.
            const content = msg.cmd === 'cleanupIgnoreFile' ? '*' : msg.content;

            // 3️⃣  Run the script in the page context.
            const [result] = await browser.scripting.executeScript({
              target: { tabId },
              world: 'MAIN',
              func: createOrUpdateIgnoreFile,
              args: [content],
            });

            sendResponse(result.result);
          } catch (e) {
            sendResponse({ ok: false, error: (e as Error).message });
          }
        })();
        return true;

      case 'generateIgnoreFileFromPlan':
        (async () => {
          const LOG_PREFIX = '[IgnoreGen]';
          const tabId = sender.tab?.id; // Ensure tabId is available for this case too
          try {
            console.log(`${LOG_PREFIX} Received request to generate .ignore file for tab ${tabId}.`);
            const { plan, fileList } = msg;

            if (!plan || !fileList || !tabId) {
              throw new Error(`Missing required parameters: plan=${!!plan}, fileList=${!!fileList}, tabId=${!!tabId}`);
            }

            console.log(`${LOG_PREFIX} Plan content:\n`, plan);
            console.log(`${LOG_PREFIX} File list:\n`, fileList.join('\n'));

            // 1. Get LLM settings from storage
            const [provider, googleKey, googleModel, openaiKey, openaiModel] = await Promise.all([
              storage.getItem<string>('local:selectedProvider'),
              storage.getItem<string>('local:googleApiKey'),
              storage.getItem<string>('local:googleModel'),
              storage.getItem<string>('local:openaiApiKey'),
              storage.getItem<string>('local:openaiModel'),
            ]);
            console.log(`${LOG_PREFIX} Using provider: ${provider || 'google'}`);

            let llm;
            let modelName;
            if (provider === 'openai' && openaiKey) {
              llm = createOpenAI({ apiKey: openaiKey });
              modelName = openaiModel || 'gpt-4o-mini';
            } else if (provider === 'google' && googleKey) {
              llm = createGoogleGenerativeAI({ apiKey: googleKey });
              modelName = googleModel || 'gemini-1.5-flash-latest';
            } else {
              throw new Error("AI provider API key not configured. Please set it in the extension options.");
            }
             console.log(`${LOG_PREFIX} Using model: ${modelName}`);

            // 2. Construct prompt
            const systemPrompt = "You are an expert programmer's assistant. Your task is to analyze an AI-generated plan and a project's file list, and then create the content for an `.ignore` file. This `.ignore` file acts as a WHITELIST. It should ignore everything by default (`*`) and then un-ignore (`!`) only the specific files and folders necessary to execute the plan. Be precise. Only include files mentioned or clearly implied by the plan. Do not include files that are not relevant to the task. The final output must be ONLY the raw text content for the file, without any explanation or markdown code block fences like ```.";
            const userPrompt = `
Here is the project's complete file list:
\`\`\`
${fileList.join('\n')}
\`\`\`

Here is the plan I want to execute:
---
${plan}
---

Generate the content for the .bolt/ignore file now.
`;
            console.log(`${LOG_PREFIX} Sending prompt to ${modelName}.`);

            // 3. Call LLM
            const { text: resultText } = await generateText({
              model: llm(modelName),
              system: systemPrompt,
              prompt: userPrompt,
            });

            console.log(`${LOG_PREFIX} Raw response from LLM:\n---\n${resultText}\n---`);
            
            // 4. Parse response (basic cleaning)
            let ignoreContent = resultText.trim();
            const codeBlockRegex = /```(?:\w+\n)?([\s\S]+?)```/;
            const match = ignoreContent.match(codeBlockRegex);
            if (match) {
              console.log(`${LOG_PREFIX} Found markdown code block, extracting content.`);
              ignoreContent = match[1].trim();
            }
            console.log(`${LOG_PREFIX} Parsed .ignore content to be written:\n---\n${ignoreContent}\n---`);

            if (!ignoreContent) {
              throw new Error("LLM returned empty content.");
            }

            // 5. Write file by injecting script
            console.log(`${LOG_PREFIX} Injecting script to write file to tab ${tabId}.`);
            const [injectionResult] = await browser.scripting.executeScript({
              target: { tabId: tabId },
              world: 'MAIN',
              func: createOrUpdateIgnoreFile,
              args: [ignoreContent],
            });
            
            console.log(`${LOG_PREFIX} File write operation result:`, injectionResult.result);
            if (!injectionResult.result?.ok) {
              throw new Error(injectionResult.result?.error || 'File write injection failed.');
            }

            sendResponse({ ok: true, result: injectionResult.result });

          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.error(`${LOG_PREFIX} Error during operation:`, e);
            sendResponse({ ok: false, error: errorMsg });
          }
        })();
        return true;

      case 'showTestNotification':
        (async () => {
          console.log(`[Background] Handling 'showTestNotification'.`);
          try {
            // FIX: When a message comes from a popup, sender.tab is undefined.
            // We must explicitly query for the active tab to find the recipient.
            const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (!activeTab?.id) {
              throw new Error("Could not find an active tab to send the notification to.");
            }
            const tabId = activeTab.id;
            
            console.log(`[Background] Found active tab ${tabId}. Sending 'showNotification' to its content script.`);
            
            await browser.tabs.sendMessage(tabId, {
              cmd: 'showNotification',
              options: {
                message: 'This is a test notification from the background script.',
                type: 'success',
                duration: 5000,
              }
            });
            
            console.log(`[Background] Successfully sent 'showNotification' to tab ${tabId}.`);
            sendResponse({ ok: true });
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.error(`[Background] Failed to send notification:`, e);
            sendResponse({ ok: false, error: `Could not send notification. Details: ${errorMsg}` });
          }
        })();
        return true; // Keep message channel open for async response.

      /* ─── OPEN OPTIONS POP-UP ────────────────────────────────────────────── */
      case 'openOptions': {
        /*  Allows content-script UI elements (e.g. notifications)
            to pop the options page so the user can enter their API key. */
        browser.runtime
          .openOptionsPage()
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: (e as Error).message }));
        return true;          // keep the message channel alive for async response
      }

      default:
        console.warn(`[Background] Received unhandled command '${msg.cmd}'.`);
        return false;
    }
  });
});
