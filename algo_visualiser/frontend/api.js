/* ═══════════════════════════════════════════════════════════
   API layer — communicates with the Pyodide Web Worker
   No backend server needed. Everything runs in the browser.
   ═══════════════════════════════════════════════════════════ */

const PyEngine = {
    worker: null,
    ready: false,
    pendingResolve: null,

    init() {
        this.worker = new Worker('worker.js');

        this.worker.onmessage = (e) => {
            const { type, data, message } = e.data;

            switch (type) {
                case 'status':
                    // Loading progress updates
                    document.getElementById('title-status').textContent = message;
                    document.getElementById('narration-text').textContent = message;
                    break;

                case 'ready':
                    // Pyodide fully loaded
                    this.ready = true;
                    document.getElementById('title-status').textContent = 'ready';
                    document.getElementById('narration-text').textContent =
                        'Ready. Paste code and run trace.';
                    document.getElementById('btn-run').disabled = false;
                    document.getElementById('btn-run').querySelector('span:last-child')
                        .textContent = 'Run Trace';
                    document.getElementById('pyodide-loader').classList.add('hidden');
                    break;

                case 'result':
                    // Trace result
                    if (this.pendingResolve) {
                        this.pendingResolve(data);
                        this.pendingResolve = null;
                    }
                    break;
            }
        };

        this.worker.onerror = (err) => {
            console.error('Worker error:', err);
            document.getElementById('title-status').textContent = 'error';
            document.getElementById('narration-text').textContent =
                'Failed to load Python environment. Check console.';
            if (this.pendingResolve) {
                this.pendingResolve(null);
                this.pendingResolve = null;
            }
        };
    }
};

async function fetchTrace(code) {
    if (!PyEngine.ready) {
        document.getElementById('narration-text').textContent =
            'Python environment is still loading. Please wait...';
        return null;
    }

    return new Promise((resolve) => {
        PyEngine.pendingResolve = resolve;
        PyEngine.worker.postMessage({ type: 'run', code });

        // Timeout: if tracing takes more than 10 seconds, abort
        setTimeout(() => {
            if (PyEngine.pendingResolve === resolve) {
                PyEngine.pendingResolve = null;

                // Terminate stuck worker and create a new one
                PyEngine.worker.terminate();
                PyEngine.ready = false;
                document.getElementById('title-status').textContent = 'restarting...';
                document.getElementById('narration-text').textContent =
                    'Execution timed out (possible infinite loop). Restarting Python...';
                PyEngine.init();

                resolve({
                    error: 'Execution timed out (10s). Check for infinite loops.',
                    steps: [],
                    source: code.split('\n')
                });
            }
        }, 10000);
    });
}

// Initialize worker immediately on page load
PyEngine.init();
