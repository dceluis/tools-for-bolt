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

import { browser } from 'wxt/browser';
import { storage } from '#imports';

declare global {
  interface Window {
    boltAssistant?: {
      ensureBoltFolderExpanded: () => Promise<void>;
      getFileTreeAsList: () => Promise<string[]>;
      findFileElementInTree: (fullPath: string) => HTMLElement | null;
      tokenizeAllFiles: () => Promise<{ path: string; content: string }[]>;
    };
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
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      // LOG: Message received in content script
      console.log('[ContentScript] Received message:', message);

      if (message.cmd === 'showNotification' && message.options) {
        console.log("[ContentScript] Matched 'showNotification' command. Calling manager.");
        notificationManager.show(message.options);
        /* respond immediately so the background `tabs.sendMessage` promise
           resolves cleanly and no timeout error is raised */
        sendResponse({ ok: true });
        /* nothing returned → channel closes right after this synchronous reply */
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

    /* --------------------------------------------------------------- *
     *  Expose helpers to the `window` object for injected scripts     *
     * --------------------------------------------------------------- */
    window.boltAssistant = {
      ensureBoltFolderExpanded,
      getFileTreeAsList,
      findFileElementInTree,
      async tokenizeAllFiles() {
        const tree = document.querySelector(EDITOR_PANEL_SELECTOR)?.closest('.flex.flex-col');
        if (!tree) return [];

        /* expand folders recursively */
        while (true) {
          const collapsed = tree.querySelectorAll<HTMLElement>(`${NODE_SELECTOR}:has(${FOLDER_ICON_SELECTOR})`);
          if (!collapsed.length) break;
          collapsed.forEach(btn=>btn.click());
          await wait(200);
        }

        /* iterate nodes, open each file & grab contents */
        const files:{path:string,content:string}[] = [];
        const stack=[''];                         // track folder path
        for (const node of tree.querySelectorAll<HTMLElement>(NODE_SELECTOR)) {
          const nameEl = node.querySelector<HTMLElement>(FILE_NAME_SELECTOR);
          if (!nameEl) continue;
          const name   = nameEl.textContent?.trim()||'unknown';
          const pad    = parseInt(node.style.paddingLeft||'0',10);
          const depth  = Math.round((pad-NODE_BASE_PADDING)/NODE_DEPTH_PADDING)+1;
          while (depth < stack.length) stack.pop();
          const parent = stack[stack.length-1];
          const full   = `${parent}/${name}`;

          const isFolder = !!node.querySelector(FOLDER_ICON_SELECTOR);
          if (isFolder) {
            stack.push(full);
            continue;
          }

          node.click();
          await wait(150);
          const cm = (document.querySelector('.cm-content') as any)?.cmView?.view;
          files.push({ path: full, content: cm ? cm.state.doc.toString() : '' });
        }
        return files;
      },
    };


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

        /* ── UI feedback ───────────────────────────────────────────── */
        const originalText = buttonTextNode.nodeValue;
        newButton.disabled      = true;
        newIcon.className       = 'text-lg i-ph:hourglass animate-spin';
        buttonTextNode.nodeValue = ' Generating...';

        try {
          /* ── 1️⃣  Extract plan text ───────────────────────────────── */
          /* Bolt often renders two markdown blocks:
             • one hidden inside the collapsed “Thoughts” section
             • one visible – the real plan we need
             We pick the first **visible** `_MarkdownContent_` block; if none are
             visible (edge-case), we fall back to the first block or a `.prose`
             element.                                                     */
          const mdBlocks = Array.from(
            planMessageEl.querySelectorAll<HTMLElement>('[class*="_MarkdownContent_"]'),
          );
          const mdEl =
            mdBlocks.find(el => el.offsetParent !== null) ||   // visible block
            mdBlocks[0] ||
            planMessageEl.querySelector<HTMLElement>('.prose');

          if (!mdEl) throw new Error('Plan markdown element not found.');

          /* textContent still works even if the node is visually hidden */
          const planText = (mdEl.textContent || '').trim();
          if (!planText) throw new Error('Plan extraction yielded an empty string.');

          console.log(`${LOG_PREFIX_ACTION} Extracted plan text (${planText.length} chars).`);

          /* ── 2️⃣  Get the complete file list from the tree ─────────── */
          const fileList = await getFileTreeAsList();
          console.log(`${LOG_PREFIX_ACTION} Retrieved file list (${fileList.length}).`);

          /* ── 3️⃣  Ask background to build/write .bolt/ignore ───────── */
          const response = await browser.runtime.sendMessage({
            cmd: 'generateIgnoreFileFromPlan',
            plan: planText,
            fileList,
          });

          if (response?.ok) {
            console.log(`${LOG_PREFIX_ACTION} ✅ .bolt/ignore generated.`);
            newIcon.className       = 'text-lg i-ph:check-circle-fill text-green-500';
            buttonTextNode.nodeValue = ' Done!';
          } else {
            throw new Error(response?.error || 'Unknown error from background script.');
          }

        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`${LOG_PREFIX_ACTION} ❌ FAILED:`, message);

          /* Missing-API-key helper */
          if (/api key.*not configured/i.test(message)) {
            notificationManager.show({
              message : 'AI provider API key is not set. Open the extension settings to add it.',
              type    : 'info',
              duration: 10_000,
              action  : {
                text    : 'Open Settings',
                callback: () => browser.runtime.sendMessage({ cmd: 'openOptions' }),
              },
            });
          } else {
            alert(`Custom Action Failed:\n${message}`);
          }

          newIcon.className       = 'text-lg i-ph:x-circle-fill text-red-500';
          buttonTextNode.nodeValue = ' Failed';
        } finally {
          setTimeout(() => {
            newButton.disabled      = false;
            newIcon.className       = 'text-lg i-ph:sparkle-fill';
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
          /* ——— Toolbar wrapper ——— */
          .bolt-mini-toolbar {
            display: flex;
            align-items: center;
            gap: .25rem;                 /* tighter spacing */
            margin-left: auto;
            background: #0d2d25;         /* darkish pill backdrop */
            padding: .25rem .5rem;
            border-radius: 9999px;
          }

          /* ——— Icon buttons ——— */
          .bolt-mini-toolbar button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.75rem;              /* smaller icons */
            height: 1.75rem;
            border-radius: 9999px;
            background: #14532d;
            color: #d1fae5;
            transition: background .15s, transform .15s;
          }
          .bolt-mini-toolbar button:hover    { background:#166534; transform:scale(1.08); }
          .bolt-mini-toolbar button:disabled { opacity:.5; cursor:not-allowed; }

          /* ——— Token counter ——— */
          .bolt-mini-toolbar .badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 2.2rem;           /* larger pill */
            height: 2.2rem;
            padding: 0 .5rem;
            background: #064e3b;
            color: #a7f3d0;
            font-size: .85rem;           /* bigger text */
            font-weight: 700;
            border-radius: 9999px;
            margin-right: .25rem;        /* breathing space before icons */
          }

          /* ——— SVG tweaks ——— */
          .bolt-mini-toolbar button svg { width: 1rem; height: 1rem; stroke-width: 2; }

          /* ——— Spinner ——— */
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

        /* ——— Add-All Ignore (file + asterisk) ——— */
        const ICON_ADDALL = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <!-- file outline -->
            <path stroke-linecap="round" stroke-linejoin="round"
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline stroke-linecap="round" stroke-linejoin="round" points="14 2 14 8 20 8"/>
            <!-- asterisk -->
            <line x1="12" y1="8"  x2="12" y2="16" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="8"  y1="12" x2="16" y2="12" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="9"  y1="9"  x2="15" y2="15" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="15" y1="9"  x2="9"  y2="15" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`;

        /* toolbar root, injected *inside* header and pushed right */
        const bar = document.createElement('div');
        bar.className = 'bolt-mini-toolbar';
        console.log('[MiniToolbar] Toolbar container created.');

        /* ────────────  DEBUG HELPERS  ──────────── */
        const DBG  = true;                 // ↺ flip to silence all debug
        const dbg  = (...a:any[]) => { if (DBG) console.debug('[MiniToolbar DBG]', ...a); };

        /* ────────────  FILE COUNTER  ──────────── */
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '…';
        badge.title = 'Included / Total files in project';

        /* A leaf-path has **no** other path that begins with it + “/”.   */
        /** Build a Set of every directory prefix in one linear sweep. */
        function buildDirSet(paths: string[]): Set<string> {
          const dirs = new Set<string>();
          for (const p of paths) {
            let idx = p.indexOf('/');
            while (idx !== -1) {
              dirs.add(p.slice(0, idx));
              idx = p.indexOf('/', idx + 1);
            }
          }
          return dirs;
        }

        /** Leaf = path that never appears in the directory-set. */
        function leafify(paths: string[]): string[] {
          const dirSet = buildDirSet(paths);
          return paths.filter(p => !dirSet.has(p));
        }

        /**
         * Refresh badge with “INCLUDED / TOTAL” *leaf-file* counts.
         * INCLUDED = files that survive `.bolt/ignore`
         * TOTAL    = every file in the store (leafs only)
         */
        async function refreshFileCounts() {
          try {
            /* 1️⃣  All files */
            const totalRes: any = await browser.runtime.sendMessage({ cmd: 'tokenizeAllFiles' });
            if (!totalRes?.ok) throw new Error(totalRes?.error || 'TOTAL query failed');

            /* 2️⃣  Respect `.bolt/ignore` */
            const incRes: any = await browser.runtime.sendMessage({ cmd: 'tokenizeAllFilesRespectIgnore' });
            if (!incRes?.ok) throw new Error(incRes?.error || 'IGNORE query failed');

            const totalPaths    = totalRes.files.map((f: any) => f.path);
            const includedPaths = incRes.files.map((f: any) => f.path);

            /* Strip *all* directory entries before counting so folders like
               “.bolt/” or “src/” can’t bloat the numerator (or denominator)
               when every child file happens to be ignored. */
            const dirSet             = buildDirSet(totalPaths);
            const totalFilePaths     = totalPaths.filter(p => !dirSet.has(p));
            const includedFilePaths  = includedPaths.filter(p => !dirSet.has(p));

            dbg('── Raw path lists ──');
            dbg(`TOTAL paths (${totalPaths.length}):`, totalPaths);
            dbg(`INCLUDED paths (${includedPaths.length}):`, includedPaths);

            /* ── Leaf calculations (directories already removed) ───── */
            const totalLeafArr    = leafify(totalFilePaths);
            const includedLeafArr = leafify(includedFilePaths);

            const totalLeaf    = totalLeafArr.length;
            const includedLeaf = includedLeafArr.length;

            /* ── Diff sets: what’s missing / unexpected? ───────────── */
            const ignoredLeafs = totalLeafArr.filter(p => !includedLeafArr.includes(p));
            const strayLeafs   = includedLeafArr.filter(p => !totalLeafArr.includes(p));

            dbg('── Leaf analysis ──');
            dbg(`totalLeaf = ${totalLeafArr.length}`, totalLeafArr);
            dbg(`includedLeaf = ${includedLeafArr.length}`, includedLeafArr);
            dbg(`ignoredLeaf (excluded) ${ignoredLeafs.length}:`, ignoredLeafs);
            dbg(`strayLeaf (???   ) ${strayLeafs.length}:`, strayLeafs);

            badge.textContent = `${includedLeaf}/${totalLeaf}`;
            badge.title       = `${includedLeaf} leaf-file${includedLeaf !== 1 ? 's' : ''} included after .bolt/ignore out of ${totalLeaf} total`;
            console.log(`[MiniToolbar] File count updated → ${badge.textContent}`);
          } catch (err) {
            console.error('[MiniToolbar] refreshFileCounts error:', err);
            badge.textContent = '0/0';
            badge.title       = 'Error retrieving file counts';
          }
        }

        /* First run + periodic refresh every 30 s */
        refreshFileCounts();
        setInterval(refreshFileCounts, 30000);

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

        /* ────────────  ADD-ALL IGNORE  ──────────── */
        const btnAddAll = document.createElement('button');
        btnAddAll.innerHTML = ICON_ADDALL;
        btnAddAll.title = 'Generate .bolt/ignore ignoring EVERY file';
        btnAddAll.setAttribute('aria-label', 'Generate full ignore');

        btnAddAll.onclick = async () => {
          console.log('[MiniToolbar] "Generate full .bolt/ignore" button clicked.');
          btnAddAll.disabled = true;
          btnAddAll.innerHTML = ICON_SPIN;
          try {
            const resp = await browser.runtime.sendMessage({ cmd: 'createFullIgnoreFile' });
            if (resp?.ok) {
              notify('All files added to ignore list', 'success');
              btnAddAll.innerHTML = ICON_CHECK;
              await refreshFileCounts();
            } else {
              throw new Error(resp?.error || 'Unknown error');
            }
          } catch (e) {
            console.error('[MiniToolbar] createFullIgnoreFile error:', e);
            notify(`Add-all failed: ${(e as Error).message}`, 'error');
            btnAddAll.innerHTML = ICON_CROSS;
          } finally {
            setTimeout(() => {
              btnAddAll.disabled = false;
              btnAddAll.innerHTML = ICON_ADDALL;
            }, 1500);
          }
        };

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
              notify('The ignore file was cleaned up', 'success');
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

        /* --- append in the new order (badge first) --- */
        bar.appendChild(badge);
        bar.appendChild(btnOpen);
        bar.appendChild(btnAddAll);
        bar.appendChild(btnReset);

        /* insert in DOM (inside header so it aligns with native pills) */
        header.appendChild(bar);
        // ── Hide toolbar when extension is disabled ─────────────────
        storage.getItem<boolean>('local:extensionEnabled').then(isEnabled => {
          bar.style.display = isEnabled !== false ? 'flex' : 'none';
        });
        storage.watch<boolean>('local:extensionEnabled', isEnabled => {
          bar.style.display = isEnabled ? 'flex' : 'none';
        });
        console.log('[MiniToolbar] Toolbar appended inside header.');

        // ─── Listen for saved .bolt/ignore events ─────────────────
        window.addEventListener('message', event => {
          if (event.data?.type === 'ignoreSaved') {
            console.log('[MiniToolbar] ignoreSaved → refreshing counts');
            refreshFileCounts();
          }
        });

        // Initialise the page‐hook (only once per tab)
        browser.runtime.sendMessage({ cmd:'initIgnoreListener' })
          .catch(err => console.warn('[MiniToolbar] initIgnoreListener failed:', err));
      },250);
    }
  },
});
