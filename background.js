let ghostWindowIds = new Set();

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
        updateIcon(false);
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
      // Save to private vault
      const data = await chrome.storage.local.get({ ghostHistory: [] });
      await chrome.storage.local.set({
        ghostHistory: [
          ...data.ghostHistory,
          { ...historyItem, time: Date.now() },
        ],
      });

      // Delete from Global History
      chrome.history.deleteUrl({ url: historyItem.url });

      // Storage Quota Warning
      const bytesUsed = await chrome.storage.sync.getBytesInUse();
      const QUOTA = chrome.storage.sync.QUOTA_BYTES; // usually 102,400

      if (bytesUsed > QUOTA * 0.9) {
        // Trigger a notification or flag for the popup
        chrome.action.setBadgeText({ text: "FULL" });
        chrome.action.setBadgeBackgroundColor({ color: "#ff4d4d" });
      }
    }
  } catch (e) {
    console.error("Error processing visited history item", e);
  }
});

function updateIcon(active) {
  // const path = active ? "icon-active.png" : "icon-idle.png";
  // chrome.action.setIcon({ path: path });
}

// Banner injection for "Ghost Mode"
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  try {
    if (changeInfo.status === "complete" && ghostWindowIds.has(tab.windowId)) {
      chrome.scripting.insertCSS({
        target: { tabId: tabId },
        css: `
        body::before {
          content: "GHOST SESSION ACTIVE - HISTORY ENCRYPTED";
          display: block;
          width: 100%;
          background: #00ff9d;
          color: black;
          text-align: center;
          font-size: 10px;
          font-weight: bold;
          padding: 4px 0;
          position: sticky;
          top: 0;
          z-index: 2147483647;
          letter-spacing: 2px;
        }
      `,
      });
    }
  } catch (e) {
    console.error("Error injecting CSS for ghost banner", e);
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
