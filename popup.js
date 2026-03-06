async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const unlockBtn = document.getElementById("unlock-trigger");
    const pinInput = document.getElementById("vault-pin");
    const lockTitle = document.getElementById("lock-title");
    const controls = document.getElementById("controls");
    const vaultScreen = document.getElementById("vault-screen");
    const lockScreen = document.getElementById("lock-screen");
    const list = document.getElementById("history-list");
    const lockBtn = document.getElementById("lock-btn");

    // Check if user has registered a PIN
    const { hashed_pin } = await chrome.storage.local.get("hashed_pin");
    if (!hashed_pin) {
      lockTitle.innerText = "Setup Your Vault";
      pinInput.placeholder = "Create 6-digit PIN";
      unlockBtn.innerText = "Set PIN";
    }

    // Click handler for both Registration and Login
    unlockBtn.addEventListener("click", async () => {
      const pin = pinInput.value;
      if (pin.length < 4) {
        alert("PIN must be at least 4 digits.");
        return;
      }

      const hashed = await hashPin(pin);

      if (!hashed_pin) {
        // REGISTRATION
        await chrome.storage.local.set({ hashed_pin: hashed });
        alert("PIN Set Successfully!");
        location.reload();
      } else {
        // LOGIN
        if (hashed === hashed_pin) {
          showVault();
        } else {
          alert("Incorrect PIN");
          pinInput.value = "";
        }
      }
    });

    function showVault() {
      lockScreen.classList.add("hidden");
      vaultScreen.classList.remove("hidden");
      // Also reveal controls in the popup if needed
      controls.classList.remove("hidden");
      renderHistory();
      updateUIState();
    }

    // Render history
    async function renderHistory() {
      const data = await chrome.storage.local.get({ ghostHistory: [] });
      list.innerHTML = data.ghostHistory
        .reverse()
        .map(
          (item) => `
      <li class="history-item">
        <div class="title">${item.title || "No Title"}</div>
        <div class="url">${new URL(item.url).hostname}</div>
      </li>
    `,
        )
        .join("");
    }

    // To ghost current tab
    ghostCurrentBtn.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab) return;

      // 1. Tell background to handle the "Teleport"
      chrome.runtime.sendMessage({
        action: "GHOST_AND_MOVE",
        url: tab.url,
        tabId: tab.id,
      });
    });

    // To open history items in ghost
    async function openInGhost(url) {
      const windowList = Array.from(ghostWindowIds);
      if (windowList.length > 0) {
        chrome.tabs.create({ windowId: windowList[0], url: url });
      } else {
        // Start new ghost window with this URL
        chrome.windows.create({ url: url, focused: true }, (win) => {
          ghostWindowIds.add(win.id);
        });
      }
    }

    lockBtn.addEventListener("click", async () => {
      try {
        // Check our background script to see if a session is live
        const response = await chrome.runtime.sendMessage({
          action: "GET_SESSION_STATUS",
        });

        if (response.isActive) {
          lockBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00ff9d" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
      </svg>
    `;
          chrome.runtime.sendMessage({ action: "STOP_GHOST_SESSION" });
        }
      } catch (e) {
        console.error("Error updating UI state", e);
      }
    });

    // UI State Check
    async function updateUIState() {
      try {
        // Check our background script to see if a session is live
        const response = await chrome.runtime.sendMessage({
          action: "GET_SESSION_STATUS",
        });

        if (response.isActive) {
          lockBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00ff9d" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
      </svg>
    `;
        } else {
          lockBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    `;
        }
      } catch (e) {
        console.error("Error updating UI state", e);
      }
    }
  } catch (err) {
    console.error("Error initializing popup", err);
  }
});
