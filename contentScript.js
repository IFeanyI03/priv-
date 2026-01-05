(() => {
    const passwordInputs = document.querySelectorAll('input[type="password"]');

    if (passwordInputs.length > 0) {
        passwordInputs.forEach((input) => {
            
            if (input.parentNode.querySelector(".pass-save-btn")) return;

            const saveBtn = document.createElement("img");
            saveBtn.src = chrome.runtime.getURL("assets/save.png");
            saveBtn.className = "pass-save-btn";
            
            
            saveBtn.style.cursor = "pointer";
            saveBtn.style.width = "20px";
            saveBtn.style.marginRight = "5px";
            saveBtn.style.verticalAlign = "middle";

            input.parentNode.insertBefore(saveBtn, input.nextSibling);

            saveBtn.addEventListener("click", () => {
                const password = input.value;
                const form = input.closest("form");
                const usernameInput = form ? form.querySelector('input[type="text"], input[type="email"]') : null;
                const username = usernameInput ? usernameInput.value : "Unknown User";
                const site = window.location.hostname;

                if (password && password.length > 0) {
                    
                    chrome.runtime.sendMessage({
                        type: "SAVE_PASSWORD",
                        data: {
                            site: site,
                            username: username,
                            password: password
                        }
                    });
                    
                    
                    alert("Credential saved!");
                } else {
                    alert("Please enter a password before saving.");
                }
            });
        });
    }
})();