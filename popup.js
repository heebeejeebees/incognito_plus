document.addEventListener("DOMContentLoaded", async () => {
  const unlockBtn = document.getElementById("unlock-trigger");
  const lockScreen = document.getElementById("lock-screen");
  const lockTitle = document.querySelector("#lock-screen h2");
  const vaultScreen = document.getElementById("vault-screen");
  const ghostCurrentBtn = document.getElementById("ghost-current");
  const list = document.getElementById("history-list");

  // unlockBtn.addEventListener("click", async () => {
  //   // For MVP: Simple click to "Unlock"
  //   lockScreen.classList.add("hidden");
  //   vaultScreen.classList.remove("hidden");
  //   renderHistory();
  //   // Next Step: Replace with WebAuthn (FaceID)
  //   // try {
  //   //   const success = await authenticateUser();
  //   //   if (success) {
  //   //     document.getElementById("lock-screen").classList.add("hidden");
  //   //     document.getElementById("vault-screen").classList.remove("hidden");
  //   //     renderHistory();
  //   //   }
  //   // } catch (err) {
  //   //   console.error("Auth failed", err);
  //   //   alert("Authentication failed. Please try again.");
  //   // }
  // });

  // WebAuthn Registration (For first-time setup)
  const { vault_registered } =
    await chrome.storage.local.get("vault_registered");

  if (!vault_registered) {
    lockTitle.innerText = "Setup Your Vault";
    unlockBtn.innerText = "Register Biometrics";
  }

  // Click handler for both Registration and Login
  unlockBtn.addEventListener("click", async () => {
    if (!vault_registered) {
      const success = await registerDevice();
      if (success) {
        chrome.storage.local.set({ vault_registered: true });
        location.reload(); // Refresh to show the Login state
      }
    } else {
      // Normal Login Flow
      const authed = await authenticateUser(); // The function we wrote earlier
      if (authed) showVault();
    }
  });

  // WebAuthn Registration
  async function registerDevice() {
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const createOptions = {
      publicKey: {
        challenge,
        rp: { name: "Incog+ Extension" },
        user: {
          id: new Uint8Array(16),
          name: "ghost-user@local",
          displayName: "Ghost User",
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }], // ES256
        authenticatorSelection: { authenticatorAttachment: "platform" },
        timeout: 60000,
      },
    };

    const credential = await navigator.credentials.create(createOptions);
    return !!credential;
  }

  // WebAuthn Login
  async function authenticateUser() {
    // 1. Check if the browser even supports biometrics
    if (!window.PublicKeyCredential) return false;

    // 2. Generate a random challenge (Proof of session)
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    // 3. Request Authentication from the OS (FaceID / TouchID / Windows Hello)
    const options = {
      publicKey: {
        challenge: challenge,
        timeout: 60000,
        userVerification: "required", // This forces the biometric prompt
        allowCredentials: [], // Empty for MVP; triggers "Security Key" or Platform auth
        authenticatorSelection: {
          authenticatorAttachment: "platform", // Tells OS to use built-in hardware (FaceID/TouchID)
        },
      },
    };

    // This line triggers the OS-level Biometric Popup
    const credential = await navigator.credentials.get(options);

    return !!credential; // If we get a credential back, the user passed the scan
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

  // UI State Check
  async function updateUIState() {
    const lockBtn = document.getElementById("lock-btn");
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
  }
});
