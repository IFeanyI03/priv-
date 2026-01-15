const addSaveButton = () => {
    const passwordInputs = document.querySelectorAll('input[type="password"]');

    passwordInputs.forEach((input) => {
        if (input.parentNode.querySelector(".pass-save-btn")) return;
        
        const saveBtn = document.createElement("img");
        saveBtn.src = chrome.runtime.getURL("assets/save.png");
        saveBtn.className = "pass-save-btn";
        saveBtn.style.cssText = "cursor:pointer; width:20px; height:20px; margin-left:5px; vertical-align:middle; display:inline-block; z-index:9999;";

        input.parentNode.insertBefore(saveBtn, input.nextSibling);

        saveBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const password = input.value;
            const form = input.closest("form");
            const usernameInput = form ? form.querySelector('input[type="text"], input[type="email"]') : null;
            
            if (password) {
                const payload = {
                    site: window.location.hostname,
                    username: usernameInput ? usernameInput.value : "Unknown User",
                    password: password,
                    color: document.querySelector("meta[name='theme-color']")?.content || "",
                    icon: document.querySelector('link[rel~="icon"]')?.href || ""
                };
                chrome.runtime.sendMessage({ type: "SAVE_PASSWORD", data: payload }, (res) => {
                    if (res?.success) alert("Credential saved!");
                    else alert("Error: " + res.error);
                });
            } else { 
                chrome.runtime.sendMessage({ type: "OPEN_POPUP" }); 
            }
        });
    });
};

addSaveButton();
new MutationObserver(addSaveButton).observe(document.body, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "FILL_CREDENTIALS") {
        const { username, password } = message.data;
        const passInputs = document.querySelectorAll('input[type="password"]');
        passInputs.forEach(input => {
            setNativeValue(input, password);
            input.style.backgroundColor = "#e8f0fe";
            const userIn = input.closest("form")?.querySelector('input[type="text"], input[type="email"]');
            if (userIn) {
                setNativeValue(userIn, username);
                userIn.style.backgroundColor = "#e8f0fe";
            }
        });
    }
});

function setNativeValue(element, value) {
    const lastValue = element.value;
    element.value = value;
    const event = new Event("input", { bubbles: true });
    if (element._valueTracker) element._valueTracker.setValue(lastValue);
    element.dispatchEvent(event);
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

function checkSharedLink() {
    if (window.location.hash.includes("share_id=") && window.location.hash.includes("key=")) {
        const params = new URLSearchParams(window.location.hash.substring(1));
        const shareId = params.get("share_id");
        const linkKey = params.get("key");

        if (!shareId || !linkKey) return;

        chrome.runtime.sendMessage({ type: "RESOLVE_SHARED_LINK", id: shareId, key: linkKey }, (res) => {
            if (res?.success) {
                setTimeout(() => {
                    if (confirm(`Accept shared access for ${res.data.s} (${res.data.u})?`)) {
                        chrome.runtime.sendMessage({ 
                            type: "SAVE_SHARE_ACCESS", 
                            data: { share_id: shareId, password: res.data.p }
                        }, (saveRes) => {
                            if (saveRes?.success) {
                                alert("Access granted!");
                                history.pushState("", document.title, window.location.pathname);
                            } else {
                                alert("Error: " + saveRes.error);
                            }
                        });
                    }
                }, 500);
            } else {
                alert("Invalid or Revoked Link.");
            }
        });
    }
}
checkSharedLink();