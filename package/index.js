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
    waitForBackend: async (timeout = 10000) => {
        // Wait for pywebview to be injected
        await waitFor(() => typeof window !== 'undefined' && window.pywebview, timeout);
        
        // Wait for api to be populated (sometimes takes a moment after injection)
        return waitFor(() => window.pywebview.api && Object.keys(window.pywebview.api).length > 0, timeout);
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
                console.error(`[Pytron] Method '${String(prop)}' not found on backend. Available methods:`, Object.keys(window.pywebview.api));
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
        // If Python sent a JSON string payload (we send the payload as a JSON string
        // to avoid JS injection), try to parse it back to an object/value.
        let payload = data;
        if (typeof data === 'string') {
            try {
                payload = JSON.parse(data);
            } catch (e) {
                // Not JSON — leave as-is
                payload = data;
            }
        }

        // Handle internal state updates automatically
        if (event === 'pytron:state-update') {
            if (payload && typeof payload === 'object' && 'key' in payload) {
                state[payload.key] = payload.value;
                // Re-emit as a specific key event
                if (listeners[`state:${payload.key}`]) {
                    listeners[`state:${payload.key}`].forEach(cb => cb(payload.value));
                }
            }
        }

        // Dispatch to listeners with the parsed payload
        if (listeners[event]) {
            listeners[event].forEach(cb => cb(payload));
        }
    };
}

export default pytron;
