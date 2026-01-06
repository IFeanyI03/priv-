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
            const username = usernameInput
                ? usernameInput.value
                : "Unknown User";
            const site = window.location.hostname;

            // 1. Get Theme Color
            const metaThemeColor = document.querySelector(
                "meta[name='theme-color']"
            );
            const themeColor = metaThemeColor ? metaThemeColor.content : "";

            // 2. Get Favicon
            // Looks for rel="icon", "shortcut icon", etc.
            const iconLink = document.querySelector('link[rel~="icon"]');
            const favicon = iconLink ? iconLink.href : "";

            if (password && password.length > 0) {
                const payload = {
                    site: site,
                    username: username,
                    password: password,
                    color: themeColor, // New field
                    icon: favicon, // New field
                };

                console.log(" [Content Script] Sending:", payload);

                chrome.runtime.sendMessage({
                    type: "SAVE_PASSWORD",
                    data: payload,
                });

                alert("Credential sent to Supabase!");
            } else {
                alert("Please enter a password before saving.");
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
