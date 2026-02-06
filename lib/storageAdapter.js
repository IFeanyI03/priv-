export const chromeStorageAdapter = {
    getItem: (key) => {
        return new Promise((resolve) => {
            if (
                typeof chrome !== "undefined" &&
                chrome.storage &&
                chrome.storage.local
            ) {
                chrome.storage.local.get([key], (result) => {
                    resolve(result[key] || null);
                });
            } else {
                // Fallback for non-extension environments (e.g. testing)
                resolve(null);
            }
        });
    },
    setItem: (key, value) => {
        return new Promise((resolve) => {
            if (
                typeof chrome !== "undefined" &&
                chrome.storage &&
                chrome.storage.local
            ) {
                chrome.storage.local.set({ [key]: value }, () => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
    },
    removeItem: (key) => {
        return new Promise((resolve) => {
            if (
                typeof chrome !== "undefined" &&
                chrome.storage &&
                chrome.storage.local
            ) {
                chrome.storage.local.remove([key], () => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
    },
};
