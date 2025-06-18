import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifestVersion: 3,
  runner: {
    startUrls: ["https://bolt.new/"]
  },
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}{{modeSuffix}}",

  manifest: ({ browser, manifestVersion, mode, command }) => (
    {
      name: "Page LLM",
      version: "1.0",
      description: "A simple extension to talk with the current page",

      permissions: ['tabs', 'activeTab', 'scripting', 'storage'],
      host_permissions: ['<all_urls>'],

      options_ui: {
        page: "entrypoints/options/index.html",
        open_in_tab: true
      },

      // Conditionally add Firefox-specific settings
      ...(browser === "firefox" && {
        browser_specific_settings: {
          gecko: {
            id: "idk@dceluis",
            strict_min_version: "109.0"
          }
        }
      })
    }
  ),
})
