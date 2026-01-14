// 1. Add Save Button to fields
const addSaveButton = () => {
    const passwordInputs = document.querySelectorAll('input[type="password"]');

    passwordInputs.forEach((input) => {
        // Prevent duplicate buttons
        if (input.parentNode.querySelector(".pass-save-btn")) return;

        const saveBtn = document.createElement("img");
        saveBtn.src = chrome.runtime.getURL("assets/save.png");
        saveBtn.className = "pass-save-btn";

        // Styling
        saveBtn.style.cursor = "pointer";
        saveBtn.style.width = "20px";
        saveBtn.style.height = "20px";
        saveBtn.style.marginRight = "5px";
        saveBtn.style.verticalAlign = "middle";
        saveBtn.style.display = "inline-block";
        saveBtn.style.zIndex = "9999";

        input.parentNode.insertBefore(saveBtn, input.nextSibling);

        saveBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const password = input.value;
            const form = input.closest("form");
            const usernameInput = form ? form.querySelector('input[type="text"], input[type="email"]') : null;
            const username = usernameInput ? usernameInput.value : "Unknown User";
            const site = window.location.hostname;

            // Get Theme Color & Favicon
            const metaThemeColor = document.querySelector("meta[name='theme-color']");
            const themeColor = metaThemeColor ? metaThemeColor.content : "";
            const iconLink = document.querySelector('link[rel~="icon"]');
            const favicon = iconLink ? iconLink.href : "";

            if (password && password.length > 0) {
                const payload = {
                    site: site,
                    username: username,
                    password: password,
                    color: themeColor,
                    icon: favicon,
                };

                chrome.runtime.sendMessage({ type: "SAVE_PASSWORD", data: payload });
                alert("Credential sent to Supabase!");
            } else {
                chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
            }
        });
    });
};

// Initial run
addSaveButton();

// Observer for dynamic pages
const observer = new MutationObserver(() => {
    addSaveButton();
});
observer.observe(document.body, { childList: true, subtree: true });

// --- LISTEN FOR FILL COMMAND ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FILL_CREDENTIALS") {
        const { username, password } = message.data;
        fillLoginForm(username, password);
    }
});

function fillLoginForm(username, password) {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length === 0) return;

    passwordInputs.forEach((passInput) => {
        setNativeValue(passInput, password);
        passInput.disabled = true;
        passInput.style.backgroundColor = "#e8f0fe"; 

        const form = passInput.closest("form");
        let userInput = null;
        if (form) {
            userInput = form.querySelector('input[type="text"], input[type="email"]');
        }

        if (userInput) {
            setNativeValue(userInput, username);
            userInput.disabled = true;
            userInput.style.backgroundColor = "#e8f0fe";
        }
    });
}

function setNativeValue(element, value) {
    const lastValue = element.value;
    element.value = value;
    const event = new Event("input", { bubbles: true });
    
    // React hack
    const tracker = element._valueTracker;
    if (tracker) {
        tracker.setValue(lastValue);
    }

    element.dispatchEvent(event);
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

// --- CHECK FOR SHARED LINKS ---
function checkSharedLink() {
    // Format: https://example.com/#share_id=UUID&key=RANDOM_STRING
    if (window.location.hash.includes("share_id=") && window.location.hash.includes("key=")) {
        
        const params = new URLSearchParams(window.location.hash.substring(1)); // remove #
        const shareId = params.get("share_id");
        const linkKey = params.get("key");

        if (!shareId || !linkKey) return;

        console.log(" [Content] Detected Shared Link. Resolving...");

        // Ask Background to Fetch & Decrypt
        chrome.runtime.sendMessage({ 
            type: "RESOLVE_SHARED_LINK", 
            id: shareId, 
            key: linkKey 
        }, (response) => {
            
            if (response && response.success) {
                const data = response.data;
                
                // Prompt User (Delay slightly for DOM readiness)
                setTimeout(() => {
                    const confirmSave = confirm(
                        `🔐 Privé Password Manager\n\n` +
                        `Incoming Shared Password:\n` +
                        `Site: ${data.s}\n` +
                        `Username: ${data.u}\n\n` +
                        `Save to your vault?`
                    );

                    if (confirmSave) {
                        const payload = {
                            site: data.s,
                            username: data.u,
                            password: data.p,
                            color: data.c,
                            icon: data.i
                        };

                        chrome.runtime.sendMessage({ type: "SAVE_PASSWORD", data: payload });
                        
                        // Clean URL
                        history.pushState("", document.title, window.location.pathname + window.location.search);
                        alert("Saved successfully!");
                    }
                }, 500);

            } else {
                alert("❌ Privé Error:\n" + (response.error || "Link is invalid or has been revoked."));
            }
        });
    }
}

// Run Link Check
checkSharedLink();