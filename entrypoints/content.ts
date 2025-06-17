// file: entrypoints/content.ts
declare global {
  interface Window {
    planDetectorInitialized?: boolean;
    assistantToolbarInjected?: boolean;
  }
}

// --- Notification System ---
class NotificationManager {
  private container: HTMLElement;
  private shadowRoot: ShadowRoot;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'bolt-assistant-notifications';
    document.body.appendChild(this.container);
    
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });
    this.injectStyles();
    // LOG: Confirming instantiation
    console.log('[NotificationManager] Initialized and attached to body.');
  }

  private injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
      }
      .notification {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        border-radius: 6px;
        color: #fff;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        opacity: 0;
        transform: translateX(100%);
        transition: opacity 0.3s ease, transform 0.3s ease;
        min-width: 280px;
        max-width: 350px;
      }
      .notification.show {
        opacity: 1;
        transform: translateX(0);
      }
      .notification.hide {
        opacity: 0;
        transform: translateX(100%);
      }
      .notification-content {
        flex-grow: 1;
      }
      .notification--info { background-color: #0284c7; }
      .notification--success { background-color: #16a34a; }
      .notification--error { background-color: #dc2626; }
      .notification-action {
        margin-left: 12px;
        padding: 4px 8px;
        border: 1px solid #fff;
        background: transparent;
        color: #fff;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        transition: background-color 0.2s;
      }
      .notification-action:hover {
        background-color: rgba(255, 255, 255, 0.2);
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  public show({ message, type = 'info', duration = 5000, action }: {
    message: string;
    type?: 'success' | 'info' | 'error';
    duration?: number;
    action?: { text: string; callback?: () => void };
  }) {
    // LOG: Show method called
    console.log(`[NotificationManager] show() called with:`, { message, type, duration, action });
    
    const notificationEl = document.createElement('div');
    notificationEl.className = `notification notification--${type}`;

    const contentEl = document.createElement('div');
    contentEl.className = 'notification-content';
    contentEl.textContent = message;
    notificationEl.appendChild(contentEl);

    if (action) {
      const actionButton = document.createElement('button');
      actionButton.className = 'notification-action';
      actionButton.textContent = action.text;
      actionButton.onclick = (e) => {
        e.stopPropagation();
        console.log(`[NotificationManager] Action button "${action.text}" clicked.`);
        action.callback?.();          // invoke the caller-supplied handler
        this.hide(notificationEl);
      };
      notificationEl.appendChild(actionButton);
    }
    
    this.shadowRoot.appendChild(notificationEl);
    console.log('[NotificationManager] Appended notification element to shadow root.');
    
    // Animate in
    requestAnimationFrame(() => {
        notificationEl.classList.add('show');
        console.log('[NotificationManager] Applied .show class for entry animation.');
    });

    if (duration > 0) {
      setTimeout(() => this.hide(notificationEl), duration);
    }
  }
  
  private hide(notificationEl: HTMLElement) {
    // LOG: Hide method called
    console.log('[NotificationManager] hide() called for element:', notificationEl);
    notificationEl.classList.remove('show');
    notificationEl.classList.add('hide');
    // Remove from DOM after animation
    notificationEl.addEventListener('transitionend', () => {
      console.log('[NotificationManager] Animation finished, removing element from DOM.');
      notificationEl.remove();
    }, { once: true });
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    // LOG: Content script main() function executed.
    console.log('[ContentScript] main() function executed.');

    if (window.planDetectorInitialized) {
      console.log('[ContentScript] Already initialized, skipping setup.');
      return;
    }
    window.planDetectorInitialized = true;

    const notificationManager = new NotificationManager();

    /* --------------------------------------------------------------- *
     *  Tiny helper so every inner closure can fire a toast quickly.   *
     * --------------------------------------------------------------- */
    const notify = (
      message: string,
      type: 'success' | 'info' | 'error' = 'info',
      duration = 5_000,
    ) => {
      console.log('[Notify]', { message, type });
      notificationManager.show({ message, type, duration });
    };

    // Listen for requests to show notifications from the background script
    browser.runtime.onMessage.addListener((message) => {
      // LOG: Message received in content script
      console.log('[ContentScript] Received message:', message);

      if (message.cmd === 'showNotification' && message.options) {
        console.log("[ContentScript] Matched 'showNotification' command. Calling manager.");
        notificationManager.show(message.options);
        return true; // Acknowledge the message was handled.
      }
    });

    const LOG_PREFIX = '[Plan Detector]';
    console.log(`${LOG_PREFIX} Initializing...`);
    
    // --- File Tree Utilities ---
    const LOG_PREFIX_TREE = '[FileTree]';
    const EDITOR_PANEL_SELECTOR = '.i-ph\\:tree-structure-duotone';
    const NODE_SELECTOR = 'button.flex.items-center.w-full';
    const COLLAPSED_FOLDER_SELECTOR = 'button.flex.items-center.w-full:has(.i-ph\\:caret-right)';
    const FOLDER_ICON_SELECTOR = '.i-ph\\:caret-down, .i-ph\\:caret-right';
    const FILE_NAME_SELECTOR = '.truncate.w-full.text-left';
    const NODE_BASE_PADDING = 6;
    const NODE_DEPTH_PADDING = 8;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /* --------------------------------------------------------------- *
     *  Helper: open `.bolt/` folder so its children are present       *
     * --------------------------------------------------------------- */
    async function ensureBoltFolderExpanded() {
      const fileTreeContainer = document
        .querySelector(EDITOR_PANEL_SELECTOR)
        ?.closest('.flex.flex-col');
      if (!fileTreeContainer) return;

      const collapsedBolt = Array.from(
        fileTreeContainer.querySelectorAll<HTMLElement>(
          `${COLLAPSED_FOLDER_SELECTOR}`,
        ),
      ).find(btn =>
        btn
          .querySelector<HTMLElement>(FILE_NAME_SELECTOR)
          ?.textContent?.trim() === '.bolt',
      );
      if (collapsedBolt) {
        collapsedBolt.click();
        await wait(250);
      }
    }

    async function getFileTreeAsList(): Promise<string[]> {
        console.log(`${LOG_PREFIX_TREE} Starting file tree extraction.`);
        const fileTreeContainer = document.querySelector(EDITOR_PANEL_SELECTOR)?.closest('.flex.flex-col');
        if (!fileTreeContainer) {
            throw new Error("Could not find the file tree container.");
        }

        // Expand all folders
        console.log(`${LOG_PREFIX_TREE} Expanding all folders...`);
        while (true) {
            const collapsedFolders = fileTreeContainer.querySelectorAll<HTMLElement>(COLLAPSED_FOLDER_SELECTOR);
            if (collapsedFolders.length === 0) {
                console.log(`${LOG_PREFIX_TREE} All folders expanded.`);
                break;
            }
            console.log(`${LOG_PREFIX_TREE} Found and clicking ${collapsedFolders.length} collapsed folder(s).`);
            collapsedFolders.forEach((folder) => folder.click());
            await wait(250); // wait for UI to update
        }

        // Read the tree
        console.log(`${LOG_PREFIX_TREE} Reading the full tree structure.`);
        const domNodes = fileTreeContainer.querySelectorAll<HTMLElement>(NODE_SELECTOR);
        const fileList: string[] = [];
        const pathStack: string[] = ['']; // root is empty string representing /home/project

        domNodes.forEach(node => {
            const nameElement = node.querySelector<HTMLElement>(FILE_NAME_SELECTOR);
            if (!nameElement) return;

            const name = nameElement.textContent?.trim() || 'unknown';
            const padding = parseInt(node.style.paddingLeft || '0', 10);
            const depth = Math.round((padding - NODE_BASE_PADDING) / NODE_DEPTH_PADDING) + 1; // 1-based

            while (depth < pathStack.length) {
                pathStack.pop();
            }
            
            const parentPath = pathStack[pathStack.length - 1];
            const fullPath = `${parentPath}/${name}`;
            
            fileList.push(fullPath);

            const isFolder = !!node.querySelector(FOLDER_ICON_SELECTOR);
            if (isFolder) {
                pathStack.push(fullPath);
            }
        });
        
        console.log(`${LOG_PREFIX_TREE} Successfully parsed file list:`, fileList);
        return fileList;
    }

    /**
     * Finds a file element in the file tree by its full path.
     * @param fullPath The full path of the file (e.g., '/home/project/.bolt/ignore').
     * @returns The HTMLElement of the file, or null if not found.
     */
    function findFileElementInTree(fullPath: string): HTMLElement | null {
      console.log(`${LOG_PREFIX_TREE} Searching for file: ${fullPath}`);
      const fileTreeContainer = document.querySelector(EDITOR_PANEL_SELECTOR)?.closest('.flex.flex-col');
      if (!fileTreeContainer) {
          console.warn(`${LOG_PREFIX_TREE} File tree container not found.`);
          return null;
      }

      // Normalize path for comparison (remove leading /home/project)
      const normalizedPath = fullPath.startsWith('/home/project') ? fullPath.substring('/home/project'.length) : fullPath;
      const pathSegments = normalizedPath.split('/').filter(s => s.length > 0);

      if (pathSegments.length === 0) {
        console.warn(`${LOG_PREFIX_TREE} Invalid or empty path provided.`);
        return null;
      }

      const domNodes = fileTreeContainer.querySelectorAll<HTMLElement>(NODE_SELECTOR);
      let currentPath = '';
      const pathStack: string[] = ['']; // root is empty string representing /home/project

      for (const node of Array.from(domNodes)) {
        const nameElement = node.querySelector<HTMLElement>(FILE_NAME_SELECTOR);
        if (!nameElement) continue;

        const name = nameElement.textContent?.trim() || 'unknown';
        const padding = parseInt(node.style.paddingLeft || '0', 10);
        const depth = Math.round((padding - NODE_BASE_PADDING) / NODE_DEPTH_PADDING) + 1; // 1-based

        while (depth < pathStack.length) {
            pathStack.pop();
        }
        
        const parentPath = pathStack[pathStack.length - 1];
        currentPath = `${parentPath}/${name}`;

        // Check if this node matches the target file
        if (currentPath === normalizedPath) {
          console.log(`${LOG_PREFIX_TREE} Found element for ${fullPath}.`);
          return node;
        }

        const isFolder = !!node.querySelector(FOLDER_ICON_SELECTOR);
        if (isFolder) {
            pathStack.push(currentPath);
        }
      }

      console.log(`${LOG_PREFIX_TREE} File ${fullPath} not found in the tree.`);
      return null;
    }


    // --- Plan Detector and Button Logic ---
    function appendCustomButton(planMessageEl: HTMLElement): void {
      const buttonContainer = planMessageEl.querySelector<HTMLElement>('.flex.items-center.gap-2.flex-wrap');
      if (!buttonContainer || buttonContainer.dataset.customButtonAdded === 'true') {
        return;
      }

      const existingButton = buttonContainer.querySelector('button');
      if (!existingButton) return;

      const newButton = document.createElement('button');
      newButton.className = existingButton.className;
      newButton.removeAttribute('disabled');
      newButton.classList.remove('disabled');
      newButton.setAttribute('role', 'button');

      const newIcon = document.createElement('div');
      newIcon.className = 'text-lg i-ph:sparkle-fill';
      newButton.appendChild(newIcon);
      const buttonTextNode = document.createTextNode(' Generate Ignore');
      newButton.appendChild(buttonTextNode);

      newButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const LOG_PREFIX_ACTION = '[CustomAction]';
        console.log(`${LOG_PREFIX_ACTION} 'Generate Ignore' button clicked.`);

        // Provide user feedback
        const originalText = buttonTextNode.nodeValue;
        newButton.disabled = true;
        newIcon.className = 'text-lg i-ph:hourglass animate-spin';
        buttonTextNode.nodeValue = ' Generating...';

        try {
            // Extract plan text
            const markdownContent = planMessageEl.querySelector('._MarkdownContent_19116_1');
            if (!markdownContent) throw new Error("Could not find plan content in message.");
            const planText = (markdownContent as HTMLElement).innerText;
            console.log(`${LOG_PREFIX_ACTION} Extracted plan text.`);

            // Get file tree
            const fileList = await getFileTreeAsList();

            // Send to background script
            console.log(`${LOG_PREFIX_ACTION} Sending plan and file list to background script.`);
            // The background script will get the tabId from the message sender object.
            const response = await browser.runtime.sendMessage({
                cmd: 'generateIgnoreFileFromPlan',
                plan: planText,
                fileList: fileList,
            });

            console.log(`${LOG_PREFIX_ACTION} Received response from background:`, response);
            if (response?.ok) {
                console.log(`${LOG_PREFIX_ACTION} ✅ SUCCESS: .bolt/ignore file operation completed.`);
                newIcon.className = 'text-lg i-ph:check-circle-fill text-green-500';
                buttonTextNode.nodeValue = ' Done!';
            } else {
                throw new Error(response?.error || 'Unknown error from background script.');
            }

        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`${LOG_PREFIX_ACTION} ❌ FAILED:`, errorMsg);

            /* If the failure is due to a missing API key, guide the user
               with an info notification that can open the settings page. */
            if (/api key.*not configured/i.test(errorMsg)) {
              notificationManager.show({
                message: 'AI provider API key is not set. Open the extension settings to add it.',
                type: 'info',
                duration: 10000,
                action: {
                  text: 'Open Settings',
                  callback: () => {
                    // Ask the background script to open the options page
                    browser.runtime.sendMessage({ cmd: 'openOptions' });
                  },
                },
              });
            } else {
              alert(`Custom Action Failed:\n${errorMsg}`);
            }

            newIcon.className = 'text-lg i-ph:x-circle-fill text-red-500';
            buttonTextNode.nodeValue = ' Failed';

        } finally {
            // Reset button after a delay
            setTimeout(() => {
                newButton.disabled = false;
                newIcon.className = 'text-lg i-ph:sparkle-fill';
                buttonTextNode.nodeValue = originalText;
            }, 5000);
        }
      });

      buttonContainer.appendChild(newButton);
      buttonContainer.dataset.customButtonAdded = 'true';
    }

    // --- Observer and Control Logic ---
    let observer: MutationObserver | null = null;

    function startDetector() {
      if (observer) return; // Already running
      console.log(`${LOG_PREFIX} Starting observer.`);

      const checkLatestPlan = () => {
        const chatContainer = document.querySelector('section[aria-label="Chat"]');
        if (!chatContainer) return;
        const allMessages = chatContainer.querySelectorAll<HTMLElement>(':scope > [data-message-id]');
        if (allMessages.length === 0) return;
        const lastMessageEl = allMessages[allMessages.length - 1];
        const buttonContainer = lastMessageEl.querySelector<HTMLElement>('.flex.items-center.gap-2.flex-wrap');
        if (!buttonContainer || buttonContainer.dataset.customButtonAdded === 'true') return;
        const isPlanStructure = lastMessageEl.querySelector('h2')?.textContent?.includes('Plan') || buttonContainer.textContent?.includes('Implement');
        if (!isPlanStructure) return;
        const hasEnabledButton = Array.from(buttonContainer.querySelectorAll('button')).some(b => !b.disabled);
        if (hasEnabledButton) {
          console.log(`${LOG_PREFIX} 🎉 Latest message is a complete plan. Appending button.`);
          appendCustomButton(lastMessageEl);
        }
      };

      observer = new MutationObserver(checkLatestPlan);

      const startupInterval = setInterval(() => {
        const chatContainer = document.querySelector('section[aria-label="Chat"]');
        if (chatContainer) {
          clearInterval(startupInterval);
          if (observer) {
            console.log(`${LOG_PREFIX} Chat container found. Attaching observer.`);
            observer.observe(chatContainer, { childList: true, subtree: true, attributes: true });
            checkLatestPlan();
          }
        }
      }, 500);
    }

    function stopDetector() {
      if (observer) {
        console.log(`${LOG_PREFIX} Stopping observer.`);
        observer.disconnect();
        observer = null;
      }
    }

    console.log(`${LOG_PREFIX} Initializing...`);
    
    (async () => {
      const isEnabled = await storage.getItem('local:extensionEnabled') !== false;
      if (isEnabled) startDetector();
    })();

    storage.watch<boolean>('local:extensionEnabled', (isEnabled) => {
      console.log(`${LOG_PREFIX} Extension state changed to: ${isEnabled ? 'Enabled' : 'Disabled'}`);
      isEnabled !== false ? startDetector() : stopDetector();
    });

    // --- Mini Toolbar Injection ---
    // This is a simple toolbar to provide quick access to .bolt/ignore and token count.
    // It's injected into the Bolt Workbench header.
    if (!window.assistantToolbarInjected) {
      window.assistantToolbarInjected = true;
      console.log('[MiniToolbar] Flag set – starting injection routine.');
      injectMiniToolbar();
    }

    function injectMiniToolbar() {
      /* bolt panel header that holds “Code | Preview” pills */
      const headerSel = '.z-workbench .flex.items-center.px-3.py-2.border-b';
      console.log('[MiniToolbar] Looking for workbench header selector:', headerSel);

      const waitHeader = setInterval(() => {
        const header = document.querySelector<HTMLElement>(headerSel);
        if (!header) {
          /* Emit a ping every ~2 s (non-spamming) so we know we’re alive */
          if (!(window as any)._miniToolbarWaiting) {
            console.log('[MiniToolbar] Header not yet found – still awaiting DOM...');
            (window as any)._miniToolbarWaiting = true;
            setTimeout(() => delete (window as any)._miniToolbarWaiting, 2000);
          }
          return;
        }
        clearInterval(waitHeader);
        console.log('[MiniToolbar] Header found! Inserting toolbar.');

        /* -------- styles (green-tinted pills) -------------------------- */
        const style = document.createElement('style');
        style.textContent = `
          .bolt-mini-toolbar          { display:flex; gap:.5rem; margin-left:auto; }
          .bolt-mini-toolbar button   {
            display:inline-flex; align-items:center; justify-content:center;
            width:2rem; height:2rem; border-radius:9999px;
            background:#14532d; color:#d1fae5;
            transition:background .15s, transform .15s;
          }
          .bolt-mini-toolbar button:hover    { background:#166534; transform:scale(1.08); }
          .bolt-mini-toolbar button:disabled { opacity:.5; cursor:not-allowed; }
          .bolt-mini-toolbar .badge {
            display:inline-flex; align-items:center; justify-content:center;
            min-width:1.6rem; height:1.6rem; padding:0 .25rem;
            background:#064e3b; color:#a7f3d0; font-size:.7rem; font-weight:700;
            border-radius:9999px;
          }
          .bolt-mini-toolbar button svg { width:1.25rem; height:1.25rem; stroke-width:2; }
          @keyframes spin { to { transform: rotate(360deg); } }
          .spin { animation: spin 1s linear infinite; }
        `;
        document.head.appendChild(style);

        /* --- inline SVG icons (no external fonts) -------------------- */
        const ICON_FILE = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline stroke-linecap="round" stroke-linejoin="round" points="14 2 14 8 20 8"/>
          </svg>`;

        const ICON_RESET   = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <polyline stroke-linecap="round" stroke-linejoin="round" points="1 4 1 10 7 10"/>
            <path   stroke-linecap="round" stroke-linejoin="round" d="M3.51 15a9 9 0 1 0 .49-5"/>
          </svg>`;

        const ICON_SPIN    = `
          <svg class="spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 2v4m0 12v4m8-8h-4M8 12H4m11.31-6.31l-2.83 2.83m0 5.66l2.83 2.83m-8.48-8.48l-2.83-2.83m0 8.48l2.83-2.83"/>
          </svg>`;

        const ICON_CHECK   = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
          </svg>`;

        const ICON_CROSS   = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <line  x1="18" y1="6" x2="6"  y2="18" stroke-linecap="round" stroke-linejoin="round"/>
            <line  x1="6"  y1="6" x2="18" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`;

        /* toolbar root, injected *inside* header and pushed right */
        const bar = document.createElement('div');
        bar.className = 'bolt-mini-toolbar';
        console.log('[MiniToolbar] Toolbar container created.');

        /* ────────────  OPEN .bolt/ignore  ──────────── */
        const btnOpen = document.createElement('button');
        btnOpen.innerHTML = ICON_FILE;
        btnOpen.title = 'Open the .bolt/ignore file';
        btnOpen.setAttribute('aria-label', 'Open .bolt/ignore');

        btnOpen.onclick = async () => {
          console.log('[MiniToolbar] "Open Ignore" button clicked.');
          try {
            /* 1️⃣  Make sure the “Code” tab is active so the file-tree exists. */
            const header = document.querySelector<HTMLElement>(headerSel);
            const codeTab = header
              ? Array.from(header.querySelectorAll('button')).find((b) =>
                  b.textContent?.trim().toLowerCase() === 'code',
                )
              : null;

            if (codeTab && codeTab.getAttribute('aria-pressed') !== 'true') {
              console.log('[MiniToolbar] Switching to “Code” tab first.');
              codeTab.click();
              await new Promise((r) => setTimeout(r, 300));
            }

            /* 2️⃣  Locate & open .bolt/ignore inside the file-tree. */
            await ensureBoltFolderExpanded();
            const el = findFileElementInTree('/home/project/.bolt/ignore');
            if (!el) {
              console.warn('[MiniToolbar] .bolt/ignore not found.');
              notify('Ignore file not found', 'error');
              return;
            }
            el.click();          // Opening itself is the feedback
          } catch (e) {
            notify(`Error: ${(e as Error).message}`, 'error');
          }
        };
        bar.appendChild(btnOpen);

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '0';
        badge.title = 'Estimated token count for the current editor content (approx. 1 token per 4 chars)';
        bar.appendChild(badge);

        setInterval(()=>{
          try{
            const cmView=(document.querySelector('.cm-content') as any)?.cmView?.view;
            if(!cmView) return;
            const len=cmView.state.doc.length;
            badge.textContent=String(Math.ceil(len/4));  // crude approx.
            /* emit sparse logs */
            if(!(window as any)._miniToolbarTokenLog){
              console.log(`[MiniToolbar] Token estimate updated → ${badge.textContent}`);
              (window as any)._miniToolbarTokenLog=true;
              setTimeout(()=>delete (window as any)._miniToolbarTokenLog,5000);
            }
          }catch{}
        },2000);

        /* ────────────  RESET GENERATED SECTION  ──────────── */
        const btnReset = document.createElement('button');
        btnReset.innerHTML = ICON_RESET;
        btnReset.title = 'Remove auto-generated section from .bolt/ignore';
        btnReset.setAttribute('aria-label', 'Reset .bolt/ignore');

        btnReset.onclick = async () => {
          console.log('[MiniToolbar] "Reset .bolt/ignore" button clicked.');
          btnReset.disabled = true;
          btnReset.innerHTML = ICON_SPIN;

          try {
            const resp = await browser.runtime.sendMessage({ cmd: 'cleanupIgnoreFile' });
            if (resp?.ok) {
              notify('Auto-generated section removed', 'success');
              btnReset.innerHTML = ICON_CHECK;
            } else {
              throw new Error(resp?.error || 'Unknown error');
            }
          } catch (e) {
            console.error('[MiniToolbar] Cleanup error:', e);
            notify(`Cleanup failed: ${(e as Error).message}`, 'error');
            btnReset.innerHTML = ICON_CROSS;
          } finally {
            setTimeout(() => {
              btnReset.disabled = false;
              btnReset.innerHTML = ICON_RESET;
            }, 1500);
          }
        };
        bar.appendChild(btnReset);

        /* insert in DOM (inside header so it aligns with native pills) */
        header.appendChild(bar);
        console.log('[MiniToolbar] Toolbar appended inside header.');
      },250);
    }
  },
});
