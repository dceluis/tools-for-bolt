import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  runner: {
    startUrls: ["https://bolt.new/"]
  },
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}{{modeSuffix}}",
  manifest: {
    // Add 'scripting' to your permissions array
    permissions: ['tabs', 'activeTab', 'scripting', 'storage'],
    host_permissions: ['<all_urls>'],
  },
})
