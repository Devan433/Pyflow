const Stepper = {
    steps: [],
    source: [],
    currentIndex: 0,
    isPlaying: false,
    intervalId: null,

    init(stepsData, sourceLines) {
        this.steps = stepsData;
        this.source = sourceLines || [];
        this.currentIndex = 0;
        this.isPlaying = false;
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = null;

        document.getElementById('btn-restart').onclick = () => { this.pause(); this.goTo(0); this.play(); };
        document.getElementById('btn-prev').onclick = () => this.prev();
        document.getElementById('btn-next').onclick = () => this.next();
        document.getElementById('btn-play').onclick = () => this.togglePlay();

        document.getElementById('speed-select').onchange = () => {
            if (this.isPlaying) { this.pause(); this.play(); }
        };

        document.getElementById('timeline-track').onclick = (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            this.goTo(Math.round(ratio * (this.steps.length - 1)));
        };

        document.onkeydown = (e) => {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); this.prev(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); this.next(); }
            else if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
        };

        this.updateUI();
    },

    goTo(index) {
        this.currentIndex = Math.max(0, Math.min(index, this.steps.length - 1));
        this.updateUI();
    },

    updateUI() {
        if (!this.steps.length) return;
        const step = this.steps[this.currentIndex];
        const prev = this.currentIndex > 0 ? this.steps[this.currentIndex - 1] : null;

        // Step counter
        document.getElementById('step-counter').textContent =
            `${this.currentIndex + 1} / ${this.steps.length}`;

        // Timeline progress
        const pct = (this.currentIndex / Math.max(1, this.steps.length - 1)) * 100;
        document.getElementById('timeline-progress').style.width = pct + '%';

        // Narration
        document.getElementById('narration-step').textContent = `L${step.line}`;
        document.getElementById('narration-text').textContent =
            step.explanation || step.code_text || '';

        // Highlight
        Highlighter.highlightLine(step.line);

        // Render
        Renderer.render(step, prev);

        // Variables
        this._updateVars(step);
    },

    _updateVars(step) {
        const el = document.getElementById('var-list');
        const badge = document.getElementById('change-count');
        const changes = new Set(step.changes || []);
        let html = '';

        for (const k in step.locals) {
            const v = step.locals[k];
            const changed = changes.has(k);
            const vs = JSON.stringify(v);
            let tc = '';
            if (Array.isArray(v)) tc = 't-arr';
            else if (typeof v === 'string') tc = 't-str';
            else if (typeof v === 'boolean') tc = 't-bool';

            html += `<div class="var-row${changed ? ' changed' : ''}">` +
                `<span class="var-dot"></span>` +
                `<span class="var-name">${k}</span>` +
                `<span class="var-eq">=</span>` +
                `<span class="var-val ${tc}">${vs}</span></div>`;
        }

        el.innerHTML = html;
        if (changes.size > 0) {
            badge.style.display = '';
            badge.textContent = `${changes.size} changed`;
        } else {
            badge.style.display = 'none';
        }
    },

    next() {
        if (this.currentIndex < this.steps.length - 1) {
            this.currentIndex++;
            this.updateUI();
        } else this.pause();
    },

    prev() {
        if (this.currentIndex > 0) { this.currentIndex--; this.updateUI(); }
    },

    togglePlay() {
        this.isPlaying ? this.pause() : (() => {
            if (this.currentIndex === this.steps.length - 1) { this.currentIndex = 0; this.updateUI(); }
            this.play();
        })();
    },

    play() {
        this.isPlaying = true;
        const btn = document.getElementById('btn-play');
        btn.textContent = '⏸'; btn.classList.add('active');
        const speed = parseInt(document.getElementById('speed-select').value);
        this.intervalId = setInterval(() => this.next(), speed);
    },

    pause() {
        this.isPlaying = false;
        const btn = document.getElementById('btn-play');
        btn.textContent = '▶'; btn.classList.remove('active');
        if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    }
};
