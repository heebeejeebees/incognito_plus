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
    const startSessionBtn = document.getElementById("start-session");
    const ghostCurrentBtn = document.getElementById("ghost-current");
    const stopSessionBtn = document.getElementById("stop-session");

    // Check if user has registered a PIN
    const { hashed_pin } = await chrome.storage.local.get("hashed_pin");
    if (!hashed_pin) {
      lockTitle.innerText = "Setup Your Vault";
      pinInput.placeholder = "Create 6-digit PIN";
      unlockBtn.innerText = "Set PIN";
    }

    // Trigger button click when 'Enter' is pressed in the input field
    pinInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        // Prevent default form behavior if you wrap this in a <form> tag later
        event.preventDefault();
        unlockBtn.click();
      }
    });

    // Auto-focus the input so the user can type immediately
    pinInput.focus();

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
      if (!hashed_pin) {
        window.location.reload(); // If no PIN, force reload to registration screen
        return;
      }
      try {
        const decryptedHistory = await loadAndDecryptHistory(hashed_pin);
        renderList(decryptedHistory);
      } catch (e) {
        console.error("Decryption failed. Wrong PIN?", e);
        alert("Could not unlock vault. Please check your PIN.");
      }
    }

    async function loadAndDecryptHistory(pin) {
      const { ghostHistory } = await chrome.storage.local.get("ghostHistory");

      if (!ghostHistory || !ghostHistory.ciphertext) {
        console.log("Vault is empty.");
        return [];
      }

      try {
        // Decrypt the entire array in one operation
        const decryptedArray = await decryptData(ghostHistory, pin);
        return decryptedArray;
      } catch (e) {
        throw new Error("Invalid PIN or corrupted data");
      }
    }

    async function renderList(history) {
      // Add Clear All button if history exists
      const clearAllHtml =
        history.length > 0
          ? `<button id="clear-all" class="btn-danger-sm">Clear All History</button>`
          : "";

      list.innerHTML =
        clearAllHtml +
        history
          .reverse()
          .map(
            (item, index) => `
    <li class="history-item" data-index="${history.length - 1 - index}">
      <div class="history-content" onclick="openInGhost('${item.url}')">
        <div class="title">${item.title || "No Title"}</div>
        <div class="url">${new URL(item.url).hostname}</div>
      </div>
      <button class="delete-item-btn" data-index="${history.length - 1 - index}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </li>
  `,
          )
          .join("");

      // Attach event listeners
      document.querySelectorAll(".delete-item-btn").forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          deleteHistoryItem(parseInt(btn.dataset.index));
        };
      });

      if (document.getElementById("clear-all")) {
        document.getElementById("clear-all").onclick = clearAllHistory;
      }
    }

    async function deleteHistoryItem(index) {
      let { ghostHistory } = await chrome.storage.local.get("ghostHistory");
      ghostHistory.splice(index, 1);
      await chrome.storage.local.set({ ghostHistory });
      renderHistory();
    }

    async function clearAllHistory() {
      if (confirm("Delete all ghost history?")) {
        await chrome.storage.local.set({ ghostHistory: [] });
        renderHistory();
      }
    }

    // To ghost current tab
    ghostCurrentBtn.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tab && !tab.url.startsWith("chrome://")) {
        chrome.runtime.sendMessage({
          action: "GHOST_AND_MOVE",
          url: tab.url,
          tabId: tab.id,
        });
        window.close();
      } else {
        alert("Cannot ghost internal Chrome pages.");
      }
    });

    // START SESSION
    startSessionBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "START_GHOST_SESSION" });
      window.close(); // Close popup so user sees the new window
    });

    // STOP SESSION
    stopSessionBtn.addEventListener("click", () => {
      if (confirm("This will close all active Ghost Windows. Proceed?")) {
        chrome.runtime.sendMessage({ action: "STOP_GHOST_SESSION" });
        // Update the UI immediately to show the 'Locked' state
        updateUIState();
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
          startSessionBtn.classList.add("active-session");
          startSessionBtn.innerText = "Session Active";
          startSessionBtn.disabled = true;
        } else {
          lockBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    `;
          startSessionBtn.classList.remove("active-session");
          startSessionBtn.innerText = "Start Ghost Session";
          startSessionBtn.disabled = false;
        }
      } catch (e) {
        console.error("Error updating UI state", e);
      }
    }
  } catch (err) {
    console.error("Error initializing popup", err);
  }

  resetPinBtn.addEventListener("click", async () => {
    // TODO do HTML first
  });

  // Reset pin
  async function changePin(oldPin, newPin) {
    try {
      // 1. Decrypt with old PIN
      const { ghostHistory } = await chrome.storage.local.get("ghostHistory");
      const decryptedData = await decryptData(ghostHistory, oldPin);

      // 2. Re-encrypt with new PIN
      const newEncryptedBlob = await encryptData(decryptedData, newPin);
      const newHashedPin = await hashPin(newPin);

      // 3. Save new PIN and new Blob
      await chrome.storage.local.set({
        hashed_pin: newHashedPin,
        ghostHistory: newEncryptedBlob,
      });

      alert("PIN updated and history migrated successfully!");
    } catch (e) {
      alert("Incorrect old PIN. Migration failed.");
    }
  }
});
