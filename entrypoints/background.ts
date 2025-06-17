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
    // ** THE FIX IS HERE **
    // Get the tabId from the message if provided (from popup), otherwise from the sender (from content script).
    const tabId = msg.tabId || sender.tab?.id;

    if (!msg || !msg.cmd) {
      return false; // Ignore invalid messages
    }

    switch (msg.cmd) {
      case 'injectAndSave':
        (async () => {
          if (!tabId) { sendResponse({ ok: false, error: "Could not identify sender tab."}); return; }
          try {
            const probeResults = await browser.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, world: 'MAIN', func: findEditorFrame });
            const targetFrame = probeResults.find(r => r.result === true);
            if (!targetFrame) {
              sendResponse({ ok: false, data: { success: false, step: 'inject', error: 'The CodeMirror editor could not be found.' } });
              return;
            }
            const [result] = await browser.scripting.executeScript({ target: { tabId: tabId, frameIds: [targetFrame.frameId] }, world: 'MAIN', func: injectAndSave, args: [msg.text] });
            sendResponse({ ok: true, data: result.result });
          } catch (e) {
            sendResponse({ ok: false, data: { success: false, step: 'inject', error: (e as Error).message } });
          }
        })();
        return true;

      case 'createOrUpdateIgnoreFile':
        (async () => {
          if (!tabId) { sendResponse({ ok: false, error: "Could not identify sender tab."}); return; }
          try {
            const [result] = await browser.scripting.executeScript({
              target: { tabId: tabId },
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

      case 'cleanupIgnoreFile':
        (async () => {
          if (!tabId) { sendResponse({ ok: false, error: "Could not identify sender tab."}); return; }
          try {
            const [result] = await browser.scripting.executeScript({
              target: { tabId: tabId },
              world: 'MAIN',
              func: createOrUpdateIgnoreFile,
              args: ['*'], // '*' is the content for cleaning up (ignore everything)
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

      default:
        // For commands that don't need a tabId or are from a different context (like popup)
        console.warn(`[Background] Received command '${msg.cmd}' which is not handled.`);
        return false;
    }
  });
});
