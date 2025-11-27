/**
 * Pytron Client Library
 * Provides a seamless bridge to the Python backend.
 */

// Event storage
const listeners = {};

// Local state cache
const state = {};

// Helper to wait for a condition
const waitFor = (condition, timeout = 5000) => {
    return new Promise((resolve, reject) => {
        if (condition()) return resolve();

        const start = Date.now();
        const interval = setInterval(() => {
            if (condition()) {
                clearInterval(interval);
                resolve();
            } else if (Date.now() - start > timeout) {
                clearInterval(interval);
                reject(new Error("Timeout waiting for condition"));
            }
        }, 100);
    });
};

// The main Pytron Proxy
const pytron = new Proxy({
    state: state, // Expose state object directly

    /**
     * Listen for an event sent from the Python backend.
     * @param {string} event - The event name.
     * @param {function} callback - The function to call when event triggers.
     */
    on: (event, callback) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
    },

    /**
     * Remove an event listener.
     * @param {string} event - The event name.
     * @param {function} callback - The function to remove.
     */
    off: (event, callback) => {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    },

    /**
     * Wait for the backend to be connected.
     * @param {number} timeout - Timeout in milliseconds.
     */
    waitForBackend: async (timeout = 5000) => {
        return waitFor(() => typeof window !== 'undefined' && window.pywebview && window.pywebview.api, timeout);
    },

    /**
     * Log a message to the Python console (if supported).
     * @param {string} message - The message to log.
     */
    log: async (message) => {
        console.log(`[Pytron Client] ${message}`);
        // Try to send to backend if available, but don't fail
        if (typeof window !== 'undefined' && window.pywebview && window.pywebview.api && window.pywebview.api.log) {
            try {
                await window.pywebview.api.log(message);
            } catch (e) { /* ignore */ }
        }
    }
}, {
    get: (target, prop) => {
        // Return local methods/properties if they exist
        if (prop in target) return target[prop];

        // Otherwise, proxy to the backend
        return async (...args) => {
            // Auto-wait for backend if not ready
            if (typeof window === 'undefined' || !window.pywebview || !window.pywebview.api) {
                try {
                    await target.waitForBackend(2000); // Wait up to 2s automatically
                } catch (e) {
                    console.warn(`[Pytron] Backend not connected. Call to '${String(prop)}' failed.`);
                    throw new Error("Pytron backend not connected");
                }
            }

            if (typeof window.pywebview.api[prop] !== 'function') {
                throw new Error(`Method '${String(prop)}' not found on Pytron backend.`);
            }

            try {
                return await window.pywebview.api[prop](...args);
            } catch (error) {
                console.error(`[Pytron] Error calling '${String(prop)}':`, error);
                throw error;
            }
        };
    }
});

// Internal dispatcher called by Python
if (typeof window !== 'undefined') {
    window.__pytron_dispatch = (event, data) => {
        // Handle internal state updates automatically
        if (event === 'pytron:state-update') {
            state[data.key] = data.value;
            // We also re-emit it as a generic event so users can subscribe to specific keys if they want
            // e.g. pytron.on('state:username', ...)
            if (listeners[`state:${data.key}`]) {
                listeners[`state:${data.key}`].forEach(cb => cb(data.value));
            }
        }

        if (listeners[event]) {
            listeners[event].forEach(cb => cb(data));
        }
    };
}

export default pytron;
