export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    console.log('[File Tree Reader] Content script loaded and waiting for editor...');

    const EDITOR_PANEL_SELECTOR = '.i-ph\\:tree-structure-duotone';
    const NODE_SELECTOR = 'button.flex.items-center.w-full';
    const FOLDER_ICON_SELECTOR = '.i-ph\\:caret-down, .i-ph\\:caret-right';
    const FILE_NAME_SELECTOR = '.truncate.w-full.text-left';

    // A more specific selector to find only folders that are currently collapsed.
    // It uses :has() to check for the 'caret-right' icon inside the button.
    const COLLAPSED_FOLDER_SELECTOR = 'button.flex.items-center.w-full:has(.i-ph\\:caret-right)';

    const NODE_BASE_PADDING = 6; // from FileTree.tsx's NodeButton
    const NODE_DEPTH_PADDING = 8; // from FileTree.tsx's NODE_PADDING_LEFT

    let hasRun = false;
    let intervalId: number;

    // Helper function to pause execution for a given time in milliseconds.
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * Finds and clicks all collapsed folders within the container, waiting for the DOM
     * to update after each batch of clicks. It continues until no collapsed folders are found.
     */
    const openAllFolders = async (container: HTMLElement) => {
      console.log('[File Tree Reader] Starting to expand all collapsed folders...');
      while (true) {
        const collapsedFolders = container.querySelectorAll<HTMLElement>(COLLAPSED_FOLDER_SELECTOR);

        if (collapsedFolders.length === 0) {
          console.log('[File Tree Reader] All folders have been expanded.');
          break; // Exit the loop when no more collapsed folders are found
        }

        console.log(`[File Tree Reader] Found and clicking ${collapsedFolders.length} collapsed folder(s).`);

        // Click each collapsed folder to expand it
        collapsedFolders.forEach((folder) => folder.click());

        // Wait a moment for the application to render the new nodes in the DOM.
        // 200ms is usually a safe bet for React re-renders.
        await wait(200);
      }
    };

    const readAndLogFileList = async () => {
      // Find all the file/folder nodes in the DOM
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

      // Stop the interval once we've successfully started the process.
      hasRun = true;
      if (intervalId) clearInterval(intervalId);

      // --- NEW: Expand all folders before parsing ---
      await openAllFolders(fileTreeContainer as HTMLElement);

      // Now that all folders are open, re-query to get the complete list of nodes.
      const domNodes = fileTreeContainer.querySelectorAll<HTMLElement>(NODE_SELECTOR);

      const root = { name: 'root', type: 'folder', children: [] as any[] };
      const path = [root]; // A stack to keep track of the current parent

      domNodes.forEach(node => {
        const isFolder = !!node.querySelector(FOLDER_ICON_SELECTOR);
        const nameElement = node.querySelector(FILE_NAME_SELECTOR);
        const name = nameElement?.textContent?.trim() || 'unknown';
        
        // Calculate depth from the 'padding-left' style
        const padding = parseInt(node.style.paddingLeft || '0', 10);
        const depth = Math.round((padding - NODE_BASE_PADDING) / NODE_DEPTH_PADDING);

        // Adjust the path stack to find the correct parent for the current node's depth
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
      console.log(JSON.parse(JSON.stringify(root.children))); // Clean way to log the object
    };

    const pollForFileTree = () => {
      // We only need to run this once.
      if (hasRun) {
        clearInterval(intervalId);
        return;
      }
      
      // Look for the "Files" header icon, which indicates the panel is likely there.
      if (document.querySelector(EDITOR_PANEL_SELECTOR)) {
        // Wait a brief moment for the tree itself to render inside the panel.
        // The main function is now async, so we'll call it and catch any potential errors.
        setTimeout(() => readAndLogFileList().catch(console.error), 250);
      }
    };
    
    // Start polling every 500ms
    intervalId = setInterval(pollForFileTree, 500);
  },
});
