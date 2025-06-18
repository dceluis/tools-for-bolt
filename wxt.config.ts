import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/auto-icons'],
  manifestVersion: 3,
  runner: {
    startUrls: ["https://bolt.new/"]
  },
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}{{modeSuffix}}",

  manifest: ({ browser, manifestVersion, mode, command }) => (
    {
      name: "Tools for Bolt",
      version: "1.0.0",
      description: "An extension to improve the bolt.new experience (experimental)",

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
            id: "tools-for-bolt@dceluis",
            strict_min_version: "109.0"
          }
        }
      })
    }
  ),
  vite: ({ mode }) => ({
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : []
    }
  })
})
