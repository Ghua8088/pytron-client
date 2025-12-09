/**
 * Pytron Client Library (Final Stable Version)
 */

// 1. LOCAL STATE
const state = {};

// 2. BACKEND READINESS CHECK
const isBackendReady = () => {
    // Priority: Check the injected flag
    if (window.pytron && window.pytron.is_ready) return true;

    // Fallback: Check for a known bound function
    const hasClose = typeof window.pytron_close === 'function';
    const hasDrag = typeof window.pytron_drag === 'function';

    // DEBUG LOG ONLY (Remove in prod if needed, but useful now)
    // console.log(`[Pytron Debug] Checking Backend: ready=${window.pytron?.is_ready}, hasClose=${hasClose}, hasDrag=${hasDrag}`);

    return typeof window !== 'undefined' && (hasClose || hasDrag);
};

// 3. WAIT LOGIC (Standalone Function)
const waitForBackend = (timeout = 3000) => {
    return new Promise((resolve, reject) => {
        if (isBackendReady()) return resolve();

        const start = Date.now();
        const interval = setInterval(() => {
            if (isBackendReady()) {
                clearInterval(interval);
                resolve();
            } else if (Date.now() - start > timeout) {
                clearInterval(interval);
                console.warn("[Pytron] Backend wait timed out.");
                resolve(); // resolve anyway to let the call proceed and fail naturally
            }
        }, 50);
    });
};

// 4. EVENT LISTENERS
const eventWrappers = new Map();

// 5. PUBLIC API OBJECT (The "Real" Object)
// We define the API explicitly first.
const pytronApi = {
    state: state,

    // Expose the wait function directly
    waitForBackend: waitForBackend,

    on: (event, callback) => {
        const wrapper = (e) => callback(e.detail !== undefined ? e.detail : e);
        if (!eventWrappers.has(callback)) eventWrappers.set(callback, wrapper);
        window.addEventListener(event, wrapper);
    },

    off: (event, callback) => {
        const wrapper = eventWrappers.get(callback);
        if (wrapper) {
            window.removeEventListener(event, wrapper);
            eventWrappers.delete(callback);
        }
    },

    log: async (message) => {
        console.log(`[Pytron Client] ${message}`);
        const logFunc = window.pytron_log || window.log;
        if (typeof logFunc === 'function') {
            try { await logFunc(message); } catch (e) { /* ignore */ }
        }
    }
};

// 6. THE PROXY (Only for dynamic Python calls)
const pytron = new Proxy(pytronApi, {
    get: (target, prop) => {
        // A. Local Method Check (Priority)
        // If the property exists on our defined API object, return it immediately.
        if (prop in target) {
            return target[prop];
        }

        // B. Ignore React/System Symbols
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') {
            return undefined;
        }

        // C. Python Bridge (Dynamic Wrapper)
        return async (...args) => {

            // 1. Wait for Backend (Using the standalone function)
            if (!isBackendReady()) {
                await waitForBackend(2000);
            }

            // 2. Execute Python Function
            const internalName = `pytron_${String(prop)}`; // e.g. pytron_minimize
            const directName = String(prop);                // e.g. greet

            // Try Internal (pytron_*)
            if (typeof window[internalName] === 'function') {
                try {
                    return await window[internalName](...args);
                } catch (err) {
                    console.error(`[Pytron] Internal error '${internalName}':`, err);
                    throw err;
                }
            }

            // Try Direct
            if (typeof window[directName] === 'function') {
                try {
                    return await window[directName](...args);
                } catch (err) {
                    console.error(`[Pytron] Python error '${directName}':`, err);
                    throw err;
                }
            }

            // 3. Not Found
            console.warn(`[Pytron] Method '${String(prop)}' not found.`);
            throw new Error(`Method '${String(prop)}' not found.`);
        };
    }
});

// Setup State Listener
if (typeof window !== 'undefined') {
    window.addEventListener('pytron:state-update', (e) => {
        const payload = e.detail;
        if (payload && typeof payload === 'object' && 'key' in payload) {
            state[payload.key] = payload.value;
            const specificEvent = new CustomEvent(`state:${payload.key}`, { detail: payload.value });
            window.dispatchEvent(specificEvent);
        }
    });
}

export default pytron;