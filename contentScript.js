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
        // In SPAs, this happens via History API, so we manually force a reload.
        if (window.location.href !== initialUrl) {
            console.log("Priv: URL changed detected. Reloading page...");
            clearInterval(checkInterval);
            window.location.reload();
        }

        // Condition B: Form Removed (e.g. Login modal closed or form replaced by Dashboard)
        if (!document.body.contains(form)) {
            console.log("Priv: Login form disappeared. Reloading page...");
            clearInterval(checkInterval);
            window.location.reload();
        }

        // Condition C: Password Field Gone (Another sign of success)
        const passField = document.querySelector('input[type="password"]');
        if (!passField && document.readyState === "complete") {
            // Only reload if we are sure the page isn't just loading
            console.log("Priv: Password field gone. Reloading...");
            clearInterval(checkInterval);
            window.location.reload();
        }
    }, 500);

    // Safety Timeout: Stop watching after 20 seconds (in case login fails or takes too long)
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
                        if (res?.success) alert("Credential saved!");
                        else alert("Error: " + res.error);
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
                        if (
                            confirm(
                                `Accept shared access for ${res.data.s} (${res.data.u})?`,
                            )
                        ) {
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
                                        alert("Access granted!");
                                        history.pushState(
                                            "",
                                            document.title,
                                            window.location.pathname,
                                        );
                                    } else {
                                        alert("Error: " + saveRes.error);
                                    }
                                },
                            );
                        }
                    }, 500);
                } else {
                    alert("Invalid or Revoked Link.");
                }
            },
        );
    }
}
checkSharedLink();
