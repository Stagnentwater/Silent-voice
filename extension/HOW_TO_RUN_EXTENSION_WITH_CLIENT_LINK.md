# Silent Voice: Run Guide (Client Link + Extension Folder Only)

This guide is for a person who only has:
1) the client app link
2) the extension folder

You do NOT need to run database, Supabase, Docker, or backend setup for this guide.

---

## What you need before starting

- A laptop/PC with Google Chrome
- Internet connection
- The client web app link (shared by the team)
- The extension folder (this project folder)

---

## Step 1: Open the extension folder

You should have a folder named extension.

Inside it, you should see:
- src
- public
- build (may already exist)
- package.json

If build exists, you can go to Step 3.

---

## Step 2: Build the extension (only if build folder is missing or old)

1. Open terminal in the extension folder
2. Run:

npm install
npm run build

3. Wait for success message from webpack

Now extension/build is ready.

---

## Step 3: Load extension in Chrome

1. Open Chrome
2. Go to: chrome://extensions
3. Turn ON Developer mode (top right)
4. Click Load unpacked
5. Select this folder:
   - extension/build

You should now see Silent Voice extension loaded.

---

## Step 4: Open the client app

1. Open the client link in a new tab
2. Join room / start flow as your team instructed

---

## Step 5: Configure pose server URL in extension popup

The extension currently works like this:
- It tries local pose server first: http://127.0.0.1:5000/pose
- If local is not reachable, it automatically falls back to the public tunnel URL

To set or change URL manually:

1. Click the extension icon in Chrome toolbar
2. In Pose server section:
   - paste base URL (without /pose) if needed
   - click Save
3. Click Test
4. If test shows OK, you are ready

Tip:
- If your team gives a new Cloudflare trycloudflare URL, save that URL in popup.

---

## Step 6: Use on supported pages

### YouTube mode

1. Open any YouTube video page
2. Extension starts fetching and rendering sign poses

### Google Meet mode

1. Open meet.google.com room
2. Open extension popup
3. Click Insert Meet Overlay

---

## Step 7: Daily startup checklist (very important)

Before demo/judging:

1. Open Chrome
2. Ensure extension is enabled in chrome://extensions
3. Open client link
4. Open extension popup and press Test once
5. If Test fails, re-save the latest public pose URL and test again

---

## Troubleshooting

### A) Extension loaded but nothing happens

- Confirm you loaded extension/build (not random parent folder)
- Refresh target page after loading extension

### B) Test button fails

- Pose server may be down
- If local server is not running, provide public URL in popup and Save
- Test again

### C) It worked earlier, now stopped

- Public quick tunnel URLs can change after restart
- Ask for latest URL and update popup

### D) Changes in source are not visible

- Rebuild extension:
  - npm run build
- Go to chrome://extensions
- Click Reload on Silent Voice extension

---

## What the user does NOT need to run

For this usage mode, the end user does not need:
- Docker
- Supabase setup
- Local PostgreSQL
- Local backend installation

They only need:
- Client link
- Extension folder (built and loaded)

---

## One-line quick summary

Load extension/build in Chrome, open client link, test pose URL in popup, and use the app. The extension will try localhost first and only use public fallback if localhost is unavailable.
