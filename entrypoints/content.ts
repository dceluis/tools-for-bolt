// file: entrypoints/content.ts
declare global {
  interface Window {
    planDetectorInitialized?: boolean;
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    console.log('[File Tree Reader] Content script loaded and waiting for editor...');

    const EDITOR_PANEL_SELECTOR = '.i-ph\\:tree-structure-duotone';
    const NODE_SELECTOR = 'button.flex.items-center.w-full';
    const FOLDER_ICON_SELECTOR = '.i-ph\\:caret-down, .i-ph\\:caret-right';
    const FILE_NAME_SELECTOR = '.truncate.w-full.text-left';

    const COLLAPSED_FOLDER_SELECTOR = 'button.flex.items-center.w-full:has(.i-ph\\:caret-right)';

    const NODE_BASE_PADDING = 6;
    const NODE_DEPTH_PADDING = 8;

    let hasRun = false;
    let intervalId: number;

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const openAllFolders = async (container: HTMLElement) => {
      console.log('[File Tree Reader] Starting to expand all collapsed folders...');
      while (true) {
        const collapsedFolders = container.querySelectorAll<HTMLElement>(COLLAPSED_FOLDER_SELECTOR);
        if (collapsedFolders.length === 0) {
          console.log('[File Tree Reader] All folders have been expanded.');
          break;
        }
        console.log(`[File Tree Reader] Found and clicking ${collapsedFolders.length} collapsed folder(s).`);
        collapsedFolders.forEach((folder) => folder.click());
        await wait(200);
      }
    };

    const readAndLogFileList = async () => {
      const fileTreeContainer = document.querySelector(EDITOR_PANEL_SELECTOR)?.closest('.flex.flex-col');
      if (!fileTreeContainer) {
        console.log('[File Tree Reader] Could not find the file tree container.');
        return;
      }

      const initialDomNodes = fileTreeContainer.querySelectorAll<HTMLElement>(NODE_SELECTOR);
      if (initialDomNodes.length === 0) {
        console.log('[File Tree Reader] Found container, but no file/folder nodes yet.');
        return;
      }

      hasRun = true;
      if (intervalId) clearInterval(intervalId);

      await openAllFolders(fileTreeContainer as HTMLElement);

      const domNodes = fileTreeContainer.querySelectorAll<HTMLElement>(NODE_SELECTOR);
      const root = { name: 'root', type: 'folder', children: [] as any[] };
      const path = [root];

      domNodes.forEach(node => {
        const isFolder = !!node.querySelector(FOLDER_ICON_SELECTOR);
        const nameElement = node.querySelector(FILE_NAME_SELECTOR);
        const name = nameElement?.textContent?.trim() || 'unknown';
        const padding = parseInt(node.style.paddingLeft || '0', 10);
        const depth = Math.round((padding - NODE_BASE_PADDING) / NODE_DEPTH_PADDING);

        while (depth < path.length - 1) {
          path.pop();
        }

        const parent = path[path.length - 1];
        if (!parent.children) parent.children = [];

        if (isFolder) {
          const folderNode = { name, type: 'folder', children: [] };
          parent.children.push(folderNode);
          path.push(folderNode);
        } else {
          const fileNode = { name, type: 'file' };
          parent.children.push(fileNode);
        }
      });

      console.log('[File Tree Reader] Successfully parsed the complete file list:');
      console.log(JSON.parse(JSON.stringify(root.children)));
    };

    const pollForFileTree = () => {
      if (hasRun) {
        clearInterval(intervalId);
        return;
      }

      if (document.querySelector(EDITOR_PANEL_SELECTOR)) {
        setTimeout(() => readAndLogFileList().catch(console.error), 250);
      }
    };

    intervalId = setInterval(pollForFileTree, 500);

    // --- New, More Robust Plan Detector ---
    if (window.planDetectorInitialized) return;
    window.planDetectorInitialized = true;

    const LOG_PREFIX = '[Plan Detector]';
    console.log(`${LOG_PREFIX} Initializing...`);

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
      newButton.appendChild(document.createTextNode(' Custom Action'));

      newButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        alert('Custom action triggered!');
      });

      buttonContainer.appendChild(newButton);
      buttonContainer.dataset.customButtonAdded = 'true'; // Prevent multiple appends
    }

    // This function checks the latest message to see if it's a completed plan.
    const checkLatestPlan = () => {
      const chatContainer = document.querySelector('section[aria-label="Chat"]');
      if (!chatContainer) return;

      const allMessages = chatContainer.querySelectorAll<HTMLElement>(':scope > [data-message-id]');
      if (allMessages.length === 0) return;

      const lastMessageEl = allMessages[allMessages.length - 1];

      const buttonContainer = lastMessageEl.querySelector<HTMLElement>('.flex.items-center.gap-2.flex-wrap');

      // If no button container, or we've already added our button, do nothing.
      if (!buttonContainer || buttonContainer.dataset.customButtonAdded === 'true') {
        return;
      }

      // A plan is identified by its header or a button with "Implement".
      const isPlanStructure = 
        lastMessageEl.querySelector('h2')?.textContent?.includes('Plan') ||
          buttonContainer.textContent?.includes('Implement');

      if (!isPlanStructure) {
        return;
      }

      // The plan is ready when its action buttons are enabled.
      const hasEnabledButton = Array.from(buttonContainer.querySelectorAll('button')).some(b => !b.disabled);

      if (hasEnabledButton) {
        console.log(`${LOG_PREFIX} 🎉 Latest message is a complete plan. Appending button.`);
        appendCustomButton(lastMessageEl);
      }
    };

    // A single, simple observer on the chat container is robust enough.
    // It triggers a check on the last message whenever anything changes.
    const observer = new MutationObserver(() => {
      checkLatestPlan();
    });

    const startupInterval = setInterval(() => {
      const chatContainer = document.querySelector('section[aria-label="Chat"]');
      if (chatContainer) {
        clearInterval(startupInterval);
        console.log(`${LOG_PREFIX} Chat container found. Attaching observer.`);
        observer.observe(chatContainer, {
          childList: true,
          subtree: true,
          attributes: true, // Needed for 'disabled' attribute changes
        });

        // Run an initial check in case the page was already loaded.
        checkLatestPlan();
      }
    }, 500);
  },
});
