// Function to check if a password field exists
(() => {
  const passwordField = document.querySelector('input[type="password"]');
  
  if (passwordField) {
    console.log("Login page detected!");

    // Send a message to the Background Script or Popup
    chrome.runtime.sendMessage({
      type: "LOGIN_DETECTED",
      url: window.location.href
    });
  }
})()


// Optional: specific to Single Page Apps (like Gmail/Twitter) where URL changes without reload
// You might need a MutationObserver here if the login form appears dynamically.