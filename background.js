importScripts("crypto.js");

let ghostWindowIds = new Set();
const MAX_HISTORY_ITEMS = 5000; // Adjust based on your performance preference

// Start or Stop Session: Open a new window and track it
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch (message.action) {
      case "START_GHOST_SESSION":
        chrome.windows.create({ focused: true }, (window) => {
          ghostWindowIds.add(window.id);
          updateIcon(true);
        });
        break;

      case "STOP_GHOST_SESSION":
        ghostWindowIds.forEach((id) => {
          chrome.windows.get(id, (win) => {
            if (!chrome.runtime.lastError && win) {
              chrome.windows.remove(id);
            }
          });
        });
        ghostWindowIds.clear();

        // Clean up UI
        updateIcon(false);
        chrome.action.setBadgeText({ text: "" });
        // Reload the tab that clicked stop to remove the banner
        if (sender.tab) {
          chrome.tabs.reload(sender.tab.id);
        }
        break;

      case "GHOST_AND_MOVE":
        const { url, tabId } = message;

        // 1. Check if a ghost window already exists
        const ghostWindowId = Array.from(ghostWindowIds)[0];

        if (ghostWindowId) {
          // Move to existing ghost window
          chrome.tabs.create({ windowId: ghostWindowId, url: url });
          chrome.tabs.remove(tabId);
        } else {
          // Create a brand new ghost window
          chrome.windows.create({ url: url, focused: true }, (window) => {
            ghostWindowIds.add(window.id);
            chrome.tabs.remove(tabId);
          });
        }

        // 2. Retroactively clean the history for this URL
        chrome.history.deleteUrl({ url: url });

      case "GET_SESSION_STATUS":
        sendResponse({ isActive: ghostWindowIds.size > 0 });
        break;

      default:
        break;
    }
  } catch (e) {
    console.error("Error handling message in background", e);
  }
});

// Save visited URLs to private vault and delete from global history
chrome.history.onVisited.addListener(async (historyItem) => {
  try {
    // Find which tab this history item came from
    const tabs = await chrome.tabs.query({ url: historyItem.url });
    const activeTab = tabs[0];

    // The Conditional Ghost: Only delete if it's in a tracked window
    if (activeTab && ghostWindowIds.has(activeTab.windowId)) {
      // Use our new FIFO-aware save function
      await saveToGhostHistory(historyItem);

      // Wipe from native history
      chrome.history.deleteUrl({ url: historyItem.url });
    }
  } catch (e) {
    console.error("Error processing visited history item", e);
  }
});

function updateIcon(active) {
  if (active) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#00ff9d" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Banner injection for "Ghost Mode"
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Trigger on 'loading' so it appears before the user sees the content
  if (
    changeInfo.status === "loading" &&
    ghostWindowIds.has(tab.windowId) &&
    tab.url &&
    !tab.url.startsWith("chrome://")
  ) {
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        func: () => {
          if (document.getElementById("ghost-banner")) return;

          const banner = document.createElement("div");
          banner.id = "ghost-banner";
          banner.innerHTML = `
          <span>GHOST SESSION ACTIVE</span>
          <button id="stop-ghost-btn">STOP SESSION</button>
        `;

          // Style the banner
          Object.assign(banner.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: "100%",
            background: "#00ff9d",
            color: "black",
            zIndex: "2147483647",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "4px 20px",
            fontSize: "11px",
            fontWeight: "bold",
            fontFamily: "sans-serif",
          });

          document.body.prepend(banner);

          // Send message to background to stop session
          document.getElementById("stop-ghost-btn").onclick = () => {
            chrome.runtime.sendMessage({ action: "STOP_GHOST_SESSION" });
          };
        },
      })
      .catch((err) => console.warn("Injection blocked on this page:", tab.url));
  }
});

// Set idle detection to 1 minute (60 seconds)
chrome.idle.setDetectionInterval(60);

chrome.idle.onStateChanged.addListener((state) => {
  try {
    if (state === "idle" || state === "locked") {
      console.log("User idle. Closing all ghost sessions for safety.");
      ghostWindowIds.forEach((id) => chrome.windows.remove(id));
      ghostWindowIds.clear();
      // Update UI or send message to popup to "Relock"
    }
  } catch (e) {
    console.error("Error handling idle state change", e);
  }
});

// Clean up the Set if user manually closes a window
chrome.windows.onRemoved.addListener((windowId) => {
  if (ghostWindowIds.has(windowId)) {
    ghostWindowIds.delete(windowId);
    if (ghostWindowIds.size === 0) {
      updateIcon(false); // Revert icon to idle
    }
  }
});

async function saveToGhostHistory(historyItem) {
  try {
    const { hashed_pin } = await chrome.storage.local.get("hashed_pin");
    if (!hashed_pin) {
      console.warn("No PIN set. Skipping history save.");
      return;
    }

    const data = await chrome.storage.local.get({ ghostHistory: [] });
    let updatedHistory = [
      ...data.ghostHistory,
      { ...historyItem, time: Date.now() },
    ];

    // FIFO Logic: If we exceed the limit, remove the oldest entries
    if (updatedHistory.length > MAX_HISTORY_ITEMS) {
      const overflow = updatedHistory.length - MAX_HISTORY_ITEMS;
      updatedHistory = updatedHistory.slice(overflow);
      console.log(`FIFO: Pruned ${overflow} oldest items from vault.`);
    }

    const encryptedData = await encryptData(updatedHistory, hashed_pin);

    await chrome.storage.local.set({ ghostHistory: encryptedData });

    // Check quota for the 'sync' UI (if you're still using it for the warning banner)
    checkStorageQuota();
  } catch (e) {
    console.error("Error in FIFO saving logic", e);
  }
}

async function checkStorageQuota() {
  const bytesUsed = await chrome.storage.local.getBytesInUse();
  // With unlimitedStorage, this is mostly for the UI warning
  // 50MB is a safe "soft limit" to warn users
  const SOFT_LIMIT = 50 * 1024 * 1024;

  if (bytesUsed > SOFT_LIMIT) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#ff4d4d" });
  }
}
