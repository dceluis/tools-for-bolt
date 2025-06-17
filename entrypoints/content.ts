export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('[CM-Injector] content script loaded (now passive).');
  },
});
