// file: entrypoints/content.ts
declare global {
  interface Window {
    planDetectorInitialized?: boolean;
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    if (window.planDetectorInitialized) return;
    window.planDetectorInitialized = true;

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
            alert(`Custom Action Failed:\n${errorMsg}`);
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
  },
});
