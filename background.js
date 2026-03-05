let ghostWindowIds = new Set();

// Start or Stop Session: Open a new window and track it
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "START_GHOST_SESSION") {
    chrome.windows.create({ focused: true }, (window) => {
      ghostWindowIds.add(window.id);
      updateIcon(true);
    });
  }

  if (message.action === "STOP_GHOST_SESSION") {
    // Close all tracked windows
    ghostWindowIds.forEach((id) => chrome.windows.remove(id));
    ghostWindowIds.clear();
    updateIcon(false);
  }
});

// Save visited URLs to private vault and delete from global history
chrome.history.onVisited.addListener(async (historyItem) => {
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
});

function updateIcon(active) {
  const path = active ? "icon-active.png" : "icon-idle.png";
  chrome.action.setIcon({ path: path });
}

// Banner injection for "Ghost Mode"
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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
});

// Set idle detection to 1 minute (60 seconds)
chrome.idle.setDetectionInterval(60);

chrome.idle.onStateChanged.addListener((state) => {
  if (state === "idle" || state === "locked") {
    console.log("User idle. Closing all ghost sessions for safety.");
    ghostWindowIds.forEach((id) => chrome.windows.remove(id));
    ghostWindowIds.clear();
    // Update UI or send message to popup to "Relock"
  }
});
