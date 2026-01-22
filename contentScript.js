// --- INJECT UI STYLES & ELEMENTS ---
const injectUI = () => {
    // 1. Inject CSS
    const style = document.createElement("style");
    style.textContent = `
        #priv-toast-container {
            position: fixed; top: 20px; right: 20px; z-index: 2147483647;
            display: flex; flex-direction: column; gap: 10px; font-family: sans-serif;
            pointer-events: none;
        }
        .priv-toast {
            background: #333; color: white; padding: 12px 20px; border-radius: 6px;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); opacity: 0;
            transform: translateX(20px); transition: all 0.3s ease; display: flex; align-items: center; gap: 8px;
            pointer-events: auto;
        }
        .priv-toast.show { opacity: 1; transform: translateX(0); }
        .priv-toast.success { background: #4caf50; }
        .priv-toast.error { background: #d32f2f; }
        
        #priv-modal-overlay {
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); z-index: 2147483647; justify-content: center; align-items: center;
            backdrop-filter: blur(2px); font-family: sans-serif;
        }
        .priv-modal {
            background: white; padding: 20px; border-radius: 8px; width: 300px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2); animation: privModalPop 0.2s ease-out;
        }
        @keyframes privModalPop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .priv-modal-title { font-weight: bold; font-size: 16px; margin-bottom: 8px; color: #153243; }
        .priv-modal-msg { font-size: 14px; color: #555; margin-bottom: 15px; line-height: 1.4; }
        .priv-modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
        .priv-modal-btn { padding: 8px 16px; border-radius: 4px; cursor: pointer; border: none; font-weight: 600; font-size: 13px; }
        .priv-modal-cancel { background: #f5f5f5; color: #333; border: 1px solid #ddd; }
        .priv-modal-confirm { background: #153243; color: white; }
    `;
    document.head.appendChild(style);

    // 2. Inject Containers
    const toastContainer = document.createElement("div");
    toastContainer.id = "priv-toast-container";
    document.body.appendChild(toastContainer);

    const modalOverlay = document.createElement("div");
    modalOverlay.id = "priv-modal-overlay";
    modalOverlay.innerHTML = `
        <div class="priv-modal">
            <div class="priv-modal-title" id="priv-modal-title"></div>
            <div class="priv-modal-msg" id="priv-modal-msg"></div>
            <div class="priv-modal-actions">
                <button class="priv-modal-btn priv-modal-cancel" id="priv-modal-cancel">Cancel</button>
                <button class="priv-modal-btn priv-modal-confirm" id="priv-modal-confirm">Confirm</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalOverlay);
};

// Initialize UI
if (document.body) injectUI();
else window.addEventListener("DOMContentLoaded", injectUI);

// --- UI HELPERS ---
function showPrivToast(message, type = "info") {
    const container = document.getElementById("priv-toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `priv-toast ${type}`;
    const icon = type === "success" ? "✔" : type === "error" ? "✖" : "ℹ";
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        toast.addEventListener("transitionend", () => toast.remove());
    }, 3000);
}

function showPrivModal(title, message, onConfirm) {
    const overlay = document.getElementById("priv-modal-overlay");
    if (!overlay) return;
    document.getElementById("priv-modal-title").innerText = title;
    document.getElementById("priv-modal-msg").innerText = message;

    const cancelBtn = document.getElementById("priv-modal-cancel");
    const confirmBtn = document.getElementById("priv-modal-confirm");

    overlay.style.display = "flex";

    const close = () => {
        overlay.style.display = "none";
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
    };
    cancelBtn.onclick = close;
    confirmBtn.onclick = () => {
        close();
        if (onConfirm) onConfirm();
    };
}

// --- HELPER: REACT-COMPATIBLE VALUE SETTER ---
function setNativeValue(element, value) {
    const lastValue = element.value;
    element.value = value;
    const event = new Event("input", { bubbles: true });
    if (element._valueTracker) {
        element._valueTracker.setValue(lastValue);
    }
    element.dispatchEvent(event);
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

// --- HELPER: AUTO-SUBMIT & RELOAD WATCHER ---
function triggerAutoLogin(form) {
    if (!form) return;

    // 1. Capture State Before Login
    const initialUrl = window.location.href;
    const submitBtn = form.querySelector(
        'button[type="submit"], input[type="submit"], button:not([type="button"])',
    );

    console.log("Priv: Attempting auto-login...");

    // 2. Perform the Click / Submit
    if (submitBtn) {
        setTimeout(() => submitBtn.click(), 200);
    } else {
        // Fallback for forms without buttons
        const passwordInput = form.querySelector('input[type="password"]');
        if (passwordInput) {
            setTimeout(() => {
                const enterEvent = {
                    key: "Enter",
                    code: "Enter",
                    charCode: 13,
                    keyCode: 13,
                    bubbles: true,
                };
                passwordInput.dispatchEvent(
                    new KeyboardEvent("keydown", enterEvent),
                );
                passwordInput.dispatchEvent(
                    new KeyboardEvent("keypress", enterEvent),
                );
                passwordInput.dispatchEvent(
                    new KeyboardEvent("keyup", enterEvent),
                );
            }, 200);
        }
    }

    // 3. SUCCESS WATCHER (The Reload Logic)
    // We check every 500ms if the login seems successful.
    const checkInterval = setInterval(() => {
        // Condition A: URL Changed (e.g. /login -> /home)
        if (window.location.href !== initialUrl) {
            console.log("Priv: URL changed detected. Reloading page...");
            clearInterval(checkInterval);
            window.location.reload();
        }

        // Condition B: Form Removed (e.g. Login modal closed)
        if (!document.body.contains(form)) {
            console.log("Priv: Login form disappeared. Reloading page...");
            clearInterval(checkInterval);
            window.location.reload();
        }

        // Condition C: Password Field Gone
        const passField = document.querySelector('input[type="password"]');
        if (!passField && document.readyState === "complete") {
            console.log("Priv: Password field gone. Reloading...");
            clearInterval(checkInterval);
            window.location.reload();
        }
    }, 500);

    // Safety Timeout: Stop watching after 20 seconds
    setTimeout(() => clearInterval(checkInterval), 20000);
}

// --- STANDARD SAVE BUTTON LOGIC ---
const addSaveButton = () => {
    const passwordInputs = document.querySelectorAll('input[type="password"]');

    passwordInputs.forEach((input) => {
        if (input.parentNode.querySelector(".pass-save-btn")) return;

        const saveBtn = document.createElement("img");
        saveBtn.src = chrome.runtime.getURL("assets/save.png");
        saveBtn.className = "pass-save-btn";
        saveBtn.style.cssText =
            "cursor:pointer; width:20px; height:20px; margin-left:5px; vertical-align:middle; display:inline-block; z-index:9999; position:relative;";

        if (input.nextSibling) {
            input.parentNode.insertBefore(saveBtn, input.nextSibling);
        } else {
            input.parentNode.appendChild(saveBtn);
        }

        saveBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const password = input.value;
            const form = input.closest("form");
            const usernameInput = form
                ? form.querySelector('input[type="text"], input[type="email"]')
                : null;

            if (password) {
                const payload = {
                    site: window.location.hostname,
                    username: usernameInput
                        ? usernameInput.value
                        : "Unknown User",
                    password: password,
                    color:
                        document.querySelector("meta[name='theme-color']")
                            ?.content || "",
                    icon:
                        document.querySelector('link[rel~="icon"]')?.href || "",
                };
                chrome.runtime.sendMessage(
                    { type: "SAVE_PASSWORD", data: payload },
                    (res) => {
                        if (res?.success)
                            showPrivToast("Credential saved!", "success");
                        else showPrivToast("Error: " + res.error, "error");
                    },
                );
            } else {
                chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
            }
        });
    });
};

addSaveButton();
new MutationObserver(addSaveButton).observe(document.body, {
    childList: true,
    subtree: true,
});

// --- MAIN LISTENER ---
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "FILL_CREDENTIALS") {
        const { username, password } = message.data;

        const passInputs = document.querySelectorAll('input[type="password"]');

        passInputs.forEach((input) => {
            const form = input.closest("form");

            // 1. Fill Password
            setNativeValue(input, password);
            input.style.backgroundColor = "#e8f0fe";

            // 2. Fill Username
            if (form) {
                const userIn = form.querySelector(
                    'input[type="text"], input[type="email"]',
                );
                if (userIn) {
                    setNativeValue(userIn, username);
                    userIn.style.backgroundColor = "#e8f0fe";
                }

                // 3. Auto-Login & Reload
                triggerAutoLogin(form);
            }
        });
    }
});

// --- SHARED LINK LOGIC ---
function checkSharedLink() {
    if (
        window.location.hash.includes("share_id=") &&
        window.location.hash.includes("key=")
    ) {
        const params = new URLSearchParams(window.location.hash.substring(1));
        const shareId = params.get("share_id");
        const linkKey = params.get("key");

        if (!shareId || !linkKey) return;

        chrome.runtime.sendMessage(
            { type: "RESOLVE_SHARED_LINK", id: shareId, key: linkKey },
            (res) => {
                if (res?.success) {
                    setTimeout(() => {
                        showPrivModal(
                            "Accept Shared Credential",
                            `Accept shared access for ${res.data.s} (${res.data.u})?`,
                            () => {
                                chrome.runtime.sendMessage(
                                    {
                                        type: "SAVE_SHARE_ACCESS",
                                        data: {
                                            share_id: shareId,
                                            password: res.data.p,
                                        },
                                    },
                                    (saveRes) => {
                                        if (saveRes?.success) {
                                            showPrivToast(
                                                "Access granted!",
                                                "success",
                                            );
                                            history.pushState(
                                                "",
                                                document.title,
                                                window.location.pathname,
                                            );
                                        } else {
                                            showPrivToast(
                                                "Error: " + saveRes.error,
                                                "error",
                                            );
                                        }
                                    },
                                );
                            },
                        );
                    }, 500);
                } else {
                    showPrivToast("Invalid or Revoked Link.", "error");
                }
            },
        );
    }
}
checkSharedLink();
