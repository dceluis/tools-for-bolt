# Tools for Bolt

_A handy browser extension to supercharge your Bolt chat and code experience, no manual ignore-file editing required!_

---

## 🚀 What It Does

- **One-click “Generate Ignore”**  
  When your assistant posts a “Plan,” a **Generate Ignore** button appears below the message. Click it and the extension will build or update your `.bolt/ignore` file, keeping your workspace tidy and your AI calls focused.

- **Mini Toolbar in the Code Tab**  
  A compact badge shows **Included / Total** file counts (leaf files only), plus three quick buttons:
![image](https://github.com/user-attachments/assets/fdd59547-e134-414e-8dbe-e3b130976736)
  - 📄 **Open `.bolt/ignore`** in the file tree
  - ♻️ **Fill `.bolt/ignore`** (add every file in your app to `.bolt/ignore`)
  - ♻️ **Reset `.bolt/ignore`** (clears out just the auto-generated block)

- **In-page Notifications**  
  Success, error or info toasts pop up right inside the Bolt interface, no need to hunt the console.

- **Enable / Disable Toggle**
  Turn all features on or off from the extension popup.

---

## 📦 Installation (Manual)

> **No store release yet, so you’ll need to install from the `dist/` folder.**  

1. **Download**  
   - For Chrome-based browsers: `dist/tools-for-bolt-1.0.*-chrome.zip`  
   - For Firefox:         `dist/tools-for-bolt-1.0.*-firefox.zip`

2. **Chrome / Edge / Opera**  
   - Unzip `tools-for-bolt-1.0.*-chrome.zip`.  
   - Go to `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the unzipped folder.

3. **Firefox**  
   - Unzip `tools-for-bolt-1.0.*-firefox.zip`.  
   - Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and choose the `manifest.json` inside the folder.

---

## ⚙️ Quick Setup

1. **Open Settings**  
   - Click the extension icon in your toolbar and choose **Options**, or click the ⚙️ gear in the extension popup.

2. **Pick Your AI Provider**  
   - **Google Gemini** or **OpenAI**  
   - Enter your API key and select a model  
   - Press **Save**

---

## 🔄 Recommended Workflow

> **Plan Mode → Reset**, **Build Mode → Generate**

1. **Plan Mode**  
   - After your assistant publishes or updates a plan, switch to the **Code** tab and click the **♻️ Reset** button.
   - This removes any previous auto-generated block in `.bolt/ignore` so you start fresh.

2. **Build Mode**  
   - When you’re ready to finalize which files to include, click **Generate Ignore**.
   - The extension will generate a proper whitelist inside `.bolt/ignore`.

---

## 🎯 How to Use

1. **Spot “Plan” messages**  
   - As soon as your assistant posts a plan (look for headings like “Plan” or “Implement…”), you’ll see **Generate Ignore** under that message.

2. **Mini Toolbar**  
   - Go to the **Code** tab. In the header you’ll find:
     - A badge with `Included / Total` file counts
     - 📄 to open `.bolt/ignore`
     - ♻️ to reset the auto-generated section

3. **In-page Toasts**  
   - Watch for short pop-ups in the top-right whenever an action succeeds or fails.

4. **Toggle Off**  
   - In the extension popup, flip the toggle to disable all features, buttons and toolbar will disappear until you re-enable.

---

## 🤔 FAQ

- **Why manage a `.bolt/ignore`?**  
  It tells Bolt which files to skip when tokenizing or previewing, saving you time and tokens.

- **No API key?**  
  You can still use the toolbar and badge; AI ignore-generation will prompt you to add one.

- **Will it touch my code?**  
  Only the `.bolt/ignore` file, and only inside the auto-generated markers. All other files remain untouched.

---

Enjoy a smoother, more focused Bolt workflow, happy coding! 🚀 
