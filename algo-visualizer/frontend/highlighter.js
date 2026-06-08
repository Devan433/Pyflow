const Highlighter = {
    _overlay: null,
    _lineHeight: 20,

    highlightLine(lineNumber) {
        const codeEl = document.getElementById('code-display');
        const container = document.getElementById('code-display-container');
        if (!codeEl || !container) return;

        const wrapper = codeEl.closest('.code-display-wrapper');
        if (!wrapper) return;
        wrapper.style.position = 'relative';

        if (!this._overlay) {
            this._overlay = document.createElement('div');
            this._overlay.id = 'line-highlight-overlay';
            wrapper.appendChild(this._overlay);
        }

        const preEl = codeEl.parentElement;
        const paddingTop = parseFloat(window.getComputedStyle(preEl).paddingTop) || 12;
        const top = paddingTop + (lineNumber - 1) * this._lineHeight;

        this._overlay.style.top = top + 'px';
        this._overlay.style.height = this._lineHeight + 'px';

        // Update active line number
        document.querySelectorAll('.line-numbers .ln').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.ln) === lineNumber);
        });

        // Auto-scroll
        const ch = container.clientHeight;
        const st = container.scrollTop;
        if (top < st || top > st + ch - this._lineHeight) {
            container.scrollTo({ top: Math.max(0, top - ch / 2), behavior: 'smooth' });
        }
    }
};
