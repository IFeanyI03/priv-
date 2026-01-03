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
            
            // Basic styling to make it sit next to the input
            saveBtn.style.cursor = "pointer";
            saveBtn.style.width = "20px";
            saveBtn.style.marginLeft = "5px";
            saveBtn.style.verticalAlign = "middle";

            // Insert it right after the password field
            input.parentNode.insertBefore(saveBtn, input.nextSibling);

            // 3. Add Click Listener
            saveBtn.addEventListener("click", () => {
                const password = input.value;
                // Heuristic: The username is often the input before the password
                // This is a simple guess; complex sites might need more logic
                const form = input.closest("form");
                const usernameInput = form ? form.querySelector('input[type="text"], input[type="email"]') : null;
                const username = usernameInput ? usernameInput.value : "Unknown User";
                const site = window.location.hostname;

                savePassword(site, username, password);
            });
        });
    }

    const savePassword = (site, username, password) => {
        // Fetch existing passwords first
        chrome.storage.sync.get(["passwords"], (result) => {
            const currentPasswords = result.passwords ? JSON.parse(result.passwords) : [];
            
            const newEntry = {
                id: Date.now(), // Unique ID for sharing later
                site: site,
                username: username,
                password: password
            };

            const updatedPasswords = [...currentPasswords, newEntry];

            chrome.storage.sync.set({
                "passwords": JSON.stringify(updatedPasswords)
            }, () => {
                alert(`Password saved for ${site}!`);
            });
        });
    };
})();