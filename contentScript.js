(() => {
    // 1. Find all password inputs
    const passwordInputs = document.querySelectorAll('input[type="password"]');

    if (passwordInputs.length > 0) {
        passwordInputs.forEach((input) => {
            // Check if we already added a button to avoid duplicates
            if (input.parentNode.querySelector(".pass-save-btn")) return;

            // 2. Create the Save Icon
            const saveBtn = document.createElement("img");
            saveBtn.src = chrome.runtime.getURL("assets/save.png");
            saveBtn.className = "pass-save-btn";
            
            // Styles
            saveBtn.style.cursor = "pointer";
            saveBtn.style.width = "20px";
            saveBtn.style.marginLeft = "5px";
            saveBtn.style.verticalAlign = "middle";

            // Insert button
            input.parentNode.insertBefore(saveBtn, input.nextSibling);

            // 3. Add Click Listener
            saveBtn.addEventListener("click", () => {
                const password = input.value;
                const form = input.closest("form");
                const usernameInput = form ? form.querySelector('input[type="text"], input[type="email"]') : null;
                const username = usernameInput ? usernameInput.value : "Unknown User";
                const site = window.location.hostname;

                // CHANGED: Send message to background.js instead of saving locally
                chrome.runtime.sendMessage({
                    type: "SAVE_PASSWORD",
                    data: {
                        site: site,
                        username: username,
                        password: password
                    }
                });
                
                alert("Sent to Supabase!");
            });
        });
    }
})();