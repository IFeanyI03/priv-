// contentScript.js

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
            const usernameInput = form
                ? form.querySelector('input[type="text"], input[type="email"]')
                : null;
            const username = usernameInput ? usernameInput.value : "Unknown User";
            const site = window.location.hostname;

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
                chrome.runtime.sendMessage({
                    type: "SAVE_PASSWORD",
                    data: payload,
                });
                alert("Processing credential...");
            } else {
                // No password typed? Open the vault popup
                chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
            }
        });
    });
};

// Initial run
addSaveButton();

// Observer for dynamic pages (SPAs)
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

/**
 * Helper to programmatically set value and trigger JS framework change events
 */
function setNativeValue(element, value) {
    const lastValue = element.value;
    element.value = value;
    const event = new Event("input", { bubbles: true });
    const tracker = element._valueTracker;
    if (tracker) {
        tracker.setValue(lastValue);
    }
    element.dispatchEvent(event);
    element.dispatchEvent(new Event("change", { bubbles: true }));
}