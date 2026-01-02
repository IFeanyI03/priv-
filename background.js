chrome.runtime.onMessage.addListener((obj, sender, sendResponse) => {
  if (obj.type === "LOGIN_DETECTED") {
    const tabId = sender.tab.id;
    
    // Perform your extension logic here
    console.log(`Working on login page: ${obj.url}`);
    
    // If you need to send data back to the tab:
    // chrome.tabs.sendMessage(tabId, { ... });
  }
});