/* ═══════════════════════════════════════════════════════════
   Renderer — Multi-structure visualization engine
   Supports: array, linked_list, hashmap, tree, matrix, set
   ═══════════════════════════════════════════════════════════ */

const Renderer = {
    svg: null,
    width: 0,
    height: 0,

    // Pointer index colors
    ptrColors: ['#4b8fef', '#e879a0', '#a78bfa', '#34d399', '#fb923c', '#f87171'],
    ptrColorMap: {},
    colorIdx: 0,

    // Pointer-like variable names (for array index detection)
    PTR_NAMES: new Set([
        'i','j','k','l','r','p','left','right','lo','hi','low','high',
        'mid','start','end','begin','head','tail','front','rear','top',
        'bottom','ptr','p1','p2','idx','index','pos','cursor','slow',
        'fast','a','b','write','read','first','last','pivot','anchor',
        'windowStart','windowEnd','result_start','result_end',
    ]),

    _createDefs() {
        const defs = this.svg.append('defs');

        // Colored pointer arrows (for arrays)
        this.ptrColors.forEach((color, i) => {
            defs.append('marker')
                .attr('id', `arrow-${i}`)
                .attr('viewBox', '0 -4 8 8')
                .attr('refX', 4).attr('refY', 0)
                .attr('markerWidth', 6).attr('markerHeight', 6)
                .attr('orient', 'auto')
                .append('path').attr('d', 'M0,-4L8,0L0,4Z').attr('fill', color);
        });

        // Generic gray arrow (for linked lists, etc.)
        defs.append('marker')
            .attr('id', 'arrow-g')
            .attr('viewBox', '0 -4 8 8')
            .attr('refX', 8).attr('refY', 0)
            .attr('markerWidth', 7).attr('markerHeight', 7)
            .attr('orient', 'auto')
            .append('path').attr('d', 'M0,-3.5L8,0L0,3.5Z').attr('fill', '#4b5563');

        // Accent arrow
        defs.append('marker')
            .attr('id', 'arrow-accent')
            .attr('viewBox', '0 -4 8 8')
            .attr('refX', 8).attr('refY', 0)
            .attr('markerWidth', 7).attr('markerHeight', 7)
            .attr('orient', 'auto')
            .append('path').attr('d', 'M0,-3.5L8,0L0,3.5Z').attr('fill', '#4b8fef');
    },

    init() {
        const area = document.querySelector('.canvas-area');
        this.width = area.clientWidth;
        this.height = area.clientHeight;
        this.svg = d3.select('#canvas');

        this._createDefs();

        window.addEventListener('resize', () => this._updateSize());
    },

    _updateSize() {
        const a = document.querySelector('.canvas-area');
        if (a) { this.width = a.clientWidth; this.height = a.clientHeight; }
    },

    _ptrColor(name) {
        if (!(name in this.ptrColorMap)) {
            this.ptrColorMap[name] = this.colorIdx % this.ptrColors.length;
            this.colorIdx++;
        }
        return {
            color: this.ptrColors[this.ptrColorMap[name]],
            idx: this.ptrColorMap[name],
        };
    },

    _isPointerName(name) {
        const lo = name.toLowerCase();
        if (this.PTR_NAMES.has(lo)) return true;
        for (const s of ['idx','index','pos','ptr','pointer','start','end'])
            if (lo.endsWith(s) || lo.startsWith(s)) return true;
        return false;
    },

    /* ═══════════════════════════════════════════════════════
       Main render dispatcher
       ═══════════════════════════════════════════════════════ */
    render(step, prevStep) {
        if (!this.svg) this.init();
        this._updateSize();

        // Reset pointer colors each trace session
        this.ptrColorMap = {};
        this.colorIdx = 0;

        // Ensure defs exist (they may have been cleared by Edit button)
        if (this.svg.select('defs').empty()) {
            this._createDefs();
        }

        const structs = step.structures || [];

        // Clear everything except defs
        this.svg.selectAll('*:not(defs)').remove();

        if (structs.length === 0) {
            this._renderFallback(step.locals);
            this._hideHUD();
            return;
        }

        // Estimate heights and layout vertically
        const margin = 14;
        const labelH = 20;
        const heights = structs.map(s => this._estimateHeight(s));
        const totalNeeded = heights.reduce((s, h) => s + h + labelH, 0)
                            + margin * (structs.length + 1);
        const scale = Math.min(1, (this.height - margin) / totalNeeded);

        let curY = margin;
        for (let i = 0; i < structs.length; i++) {
            const s = structs[i];
            const sectionH = (heights[i] + labelH) * scale;

            // Section label
            this.svg.append('text')
                .attr('x', 16).attr('y', curY + 12)
                .attr('font-family', 'Inter, system-ui, sans-serif')
                .attr('font-size', '10px')
                .attr('fill', '#6b7280')
                .attr('font-weight', 600)
                .attr('letter-spacing', '0.6px')
                .text(`${this._structLabel(s.type)}  ${s.name}`);

            const cy = curY + labelH;
            const ch = sectionH - labelH;

            switch (s.type) {
                case 'array':       this._renderArray(s, cy, ch, step); break;
                case 'linked_list': this._renderLinkedList(s, cy, ch); break;
                case 'hashmap':     this._renderHashMap(s, cy, ch); break;
                case 'tree':        this._renderTree(s, cy, ch); break;
                case 'matrix':      this._renderMatrix(s, cy, ch); break;
                case 'set':         this._renderSet(s, cy, ch); break;
                default:            break;
            }

            curY += sectionH + margin;
        }

        // Array HUD
        const arrStruct = structs.find(s => s.type === 'array');
        if (arrStruct) {
            this._updateArrayHUD(arrStruct, step);
        } else {
            this._hideHUD();
        }
    },

    _structLabel(type) {
        const m = {
            array: 'ARRAY', linked_list: 'LINKED LIST', hashmap: 'HASHMAP',
            tree: 'TREE', matrix: 'MATRIX', set: 'SET',
        };
        return m[type] || type.toUpperCase();
    },

    _estimateHeight(s) {
        switch (s.type) {
            case 'array':       return 110;
            case 'linked_list': return 80;
            case 'hashmap':     return 24 + Math.min(s.entries.length, 10) * 26;
            case 'tree':        return 20 + this._treeDepth(s.root) * 60;
            case 'matrix':      return 20 + Math.min(s.rows.length, 10) * 32;
            case 'set':         return 50;
            default:            return 50;
        }
    },

    _treeDepth(node, visited) {
        if (!node) return 0;
        if (!visited) visited = new Set();
        if (visited.has(node.id)) return 0;
        visited.add(node.id);
        return 1 + Math.max(
            this._treeDepth(node.left, visited),
            this._treeDepth(node.right, visited)
        );
    },

    /* ═══════════════════════════════════════════════════════
       ARRAY renderer
       ═══════════════════════════════════════════════════════ */
    _renderArray(struct, y, h, step) {
        const arr = struct.values;
        const arrName = struct.name;
        if (!arr || arr.length === 0) return;

        // Detect pointer variables from locals
        const pointers = [];
        if (step.locals) {
            for (const k in step.locals) {
                if (k === arrName) continue;
                if (!this._isPointerName(k)) continue;
                const v = step.locals[k];
                if (typeof v === 'number' && Number.isInteger(v)
                    && v >= 0 && v < arr.length) {
                    pointers.push({ name: k, index: v });
                }
            }
        }

        const maxW = 52, minW = 34, gap = 3;
        const cellW = Math.max(minW, Math.min(maxW, (this.width - 80) / arr.length - gap));
        const cellH = 40;
        const totalW = arr.length * (cellW + gap) - gap;
        const sx = (this.width - totalW) / 2;
        const sy = y + (h - cellH) / 2 - 14;

        const ptrIndices = new Set(pointers.map(p => p.index));

        // Index labels
        arr.forEach((_, i) => {
            this.svg.append('text')
                .attr('x', sx + i * (cellW + gap) + cellW / 2)
                .attr('y', sy - 5)
                .attr('text-anchor', 'middle')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '9px').attr('fill', '#4b5563')
                .text(i);
        });

        // Cells
        arr.forEach((val, i) => {
            const cx = sx + i * (cellW + gap);
            const isPtr = ptrIndices.has(i);
            this.svg.append('rect')
                .attr('x', cx).attr('y', sy)
                .attr('width', cellW).attr('height', cellH)
                .attr('rx', 3)
                .attr('fill', isPtr ? 'rgba(75,143,239,0.08)' : '#1c1f28')
                .attr('stroke', isPtr ? '#4b8fef' : '#2a2d37')
                .attr('stroke-width', isPtr ? 1.5 : 1);

            this.svg.append('text')
                .attr('x', cx + cellW / 2).attr('y', sy + cellH / 2)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '13px').attr('fill', '#d1d5db')
                .text(val === null ? '∅' : val);
        });

        // Pointer arrows
        pointers.forEach(p => {
            const pc = this._ptrColor(p.name);
            const px = sx + p.index * (cellW + gap) + cellW / 2;
            const py = sy + cellH + 8;

            this.svg.append('line')
                .attr('x1', px).attr('y1', py + 18)
                .attr('x2', px).attr('y2', py + 3)
                .attr('stroke', pc.color).attr('stroke-width', 1.5)
                .attr('marker-end', `url(#arrow-${pc.idx})`);

            this.svg.append('text')
                .attr('x', px).attr('y', py + 30)
                .attr('text-anchor', 'middle')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '10px').attr('fill', pc.color)
                .text(`${p.name}=${p.index}`);
        });
    },

    /* ═══════════════════════════════════════════════════════
       LINKED LIST renderer
       ═══════════════════════════════════════════════════════ */
    _renderLinkedList(struct, y, h) {
        const nodes = struct.nodes;
        if (!nodes || nodes.length === 0) return;

        const nodeW = 58, nodeH = 34, arrowW = 28;
        const totalW = nodes.length * nodeW + (nodes.length - 1) * arrowW;
        const sx = Math.max(16, (this.width - totalW) / 2);
        const cy = y + h / 2;

        nodes.forEach((n, i) => {
            const nx = sx + i * (nodeW + arrowW);
            const ny = cy - nodeH / 2;
            const isSentinel = n.sentinel;

            // Node box
            this.svg.append('rect')
                .attr('x', nx).attr('y', ny)
                .attr('width', nodeW).attr('height', nodeH)
                .attr('rx', 3)
                .attr('fill', isSentinel ? '#161920'
                    : (n.active ? 'rgba(75,143,239,0.10)' : '#1c1f28'))
                .attr('stroke', n.active ? '#4b8fef'
                    : (isSentinel ? '#21242d' : '#2a2d37'))
                .attr('stroke-width', n.active ? 1.5 : 1);

            // Node label
            let label;
            if (isSentinel) {
                label = '·';
            } else {
                const vals = Object.values(n.fields);
                label = vals.length > 0 ? vals.join(':') : '?';
            }

            this.svg.append('text')
                .attr('x', nx + nodeW / 2).attr('y', cy)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', isSentinel ? '14px' : '12px')
                .attr('fill', isSentinel ? '#374151' : '#d1d5db')
                .text(label);

            // Arrow to next
            if (i < nodes.length - 1) {
                const ax1 = nx + nodeW + 4;
                const ax2 = nx + nodeW + arrowW - 4;
                this.svg.append('line')
                    .attr('x1', ax1).attr('y1', cy)
                    .attr('x2', ax2).attr('y2', cy)
                    .attr('stroke', '#4b5563').attr('stroke-width', 1.5)
                    .attr('marker-end', 'url(#arrow-g)');
            }
        });
    },

    /* ═══════════════════════════════════════════════════════
       HASHMAP renderer
       ═══════════════════════════════════════════════════════ */
    _renderHashMap(struct, y, h) {
        const entries = struct.entries;
        if (!entries || entries.length === 0) {
            this.svg.append('text')
                .attr('x', this.width / 2).attr('y', y + h / 2)
                .attr('text-anchor', 'middle')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '11px').attr('fill', '#4b5563')
                .text('{}');
            return;
        }

        const rowH = 24, keyW = 56, valW = 140, pad = 8;
        const totalW = keyW + valW + pad * 2;
        const maxRows = Math.min(entries.length, 10);
        const tableH = maxRows * rowH;
        const sx = (this.width - totalW) / 2;
        const sy = y + Math.max(0, (h - tableH) / 2);

        // Border
        this.svg.append('rect')
            .attr('x', sx).attr('y', sy)
            .attr('width', totalW).attr('height', tableH)
            .attr('fill', 'none').attr('stroke', '#2a2d37')
            .attr('rx', 3).attr('stroke-width', 1);

        // Column separator
        this.svg.append('line')
            .attr('x1', sx + keyW + pad).attr('y1', sy)
            .attr('x2', sx + keyW + pad).attr('y2', sy + tableH)
            .attr('stroke', '#21242d').attr('stroke-width', 1);

        entries.slice(0, maxRows).forEach((e, i) => {
            const ry = sy + i * rowH;

            // Row background
            if (e.active) {
                this.svg.append('rect')
                    .attr('x', sx + 1).attr('y', ry + 1)
                    .attr('width', totalW - 2).attr('height', rowH - 1)
                    .attr('fill', 'rgba(75,143,239,0.06)')
                    .attr('rx', 2);
            }

            // Row separator
            if (i > 0) {
                this.svg.append('line')
                    .attr('x1', sx).attr('y1', ry)
                    .attr('x2', sx + totalW).attr('y2', ry)
                    .attr('stroke', '#1c1f28').attr('stroke-width', 1);
            }

            // Key
            this.svg.append('text')
                .attr('x', sx + pad + keyW / 2).attr('y', ry + rowH / 2)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '11px').attr('fill', '#7ec8e3')
                .text(String(e.key));

            // Value
            const valStr = typeof e.value === 'string' ? e.value : JSON.stringify(e.value);
            this.svg.append('text')
                .attr('x', sx + keyW + pad * 2).attr('y', ry + rowH / 2)
                .attr('dominant-baseline', 'central')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '11px').attr('fill', '#d1d5db')
                .text(valStr.length > 20 ? valStr.slice(0, 18) + '…' : valStr);
        });

        if (entries.length > maxRows) {
            this.svg.append('text')
                .attr('x', sx + totalW / 2).attr('y', sy + tableH + 14)
                .attr('text-anchor', 'middle')
                .attr('font-family', 'Inter, sans-serif')
                .attr('font-size', '10px').attr('fill', '#4b5563')
                .text(`+ ${entries.length - maxRows} more`);
        }
    },

    /* ═══════════════════════════════════════════════════════
       TREE renderer (in-order layout)
       ═══════════════════════════════════════════════════════ */
    _renderTree(struct, y, h) {
        const { nodes, edges } = this._layoutTreeNodes(struct.root);
        if (nodes.length === 0) return;

        const maxX = Math.max(...nodes.map(n => n._x));
        const maxY = Math.max(...nodes.map(n => n._y));
        const nodeR = 18;

        const availW = this.width - 60;
        const availH = h - 20;
        const spacingX = maxX > 0 ? Math.min(56, availW / maxX) : 0;
        const spacingY = maxY > 0 ? Math.min(58, availH / maxY) : 0;

        const offsetX = (this.width - maxX * spacingX) / 2;
        const offsetY = y + nodeR + 4;

        const px = n => offsetX + n._x * spacingX;
        const py = n => offsetY + n._y * spacingY;

        // Edges
        edges.forEach(e => {
            this.svg.append('line')
                .attr('x1', px(e.from)).attr('y1', py(e.from))
                .attr('x2', px(e.to)).attr('y2', py(e.to))
                .attr('stroke', '#2a2d37').attr('stroke-width', 1.5);
        });

        // Nodes
        nodes.forEach(n => {
            const cx = px(n), cy = py(n);
            this.svg.append('circle')
                .attr('cx', cx).attr('cy', cy).attr('r', nodeR)
                .attr('fill', '#1c1f28')
                .attr('stroke', '#2a2d37').attr('stroke-width', 1.5);

            this.svg.append('text')
                .attr('x', cx).attr('y', cy)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '12px').attr('fill', '#d1d5db')
                .text(n.val !== null && n.val !== undefined ? n.val : '·');
        });
    },

    _layoutTreeNodes(root) {
        const nodes = [], edges = [];
        let counter = 0;

        function inorder(n, depth, parent) {
            if (!n) return;
            inorder(n.left, depth + 1, n);
            n._x = counter++;
            n._y = depth;
            nodes.push(n);
            if (parent) edges.push({ from: parent, to: n });
            inorder(n.right, depth + 1, n);
        }

        inorder(root, 0, null);
        return { nodes, edges };
    },

    /* ═══════════════════════════════════════════════════════
       MATRIX renderer
       ═══════════════════════════════════════════════════════ */
    _renderMatrix(struct, y, h) {
        const rows = struct.rows;
        if (!rows || rows.length === 0) return;

        const maxRows = Math.min(rows.length, 10);
        const cols = rows[0].length;
        const maxCols = Math.min(cols, 15);

        const cellW = Math.min(40, (this.width - 80) / (maxCols + 1));
        const cellH = Math.min(30, (h - 10) / (maxRows + 1));
        const totalW = (maxCols + 1) * cellW;
        const sx = (this.width - totalW) / 2;

        // Column labels
        for (let c = 0; c < maxCols; c++) {
            this.svg.append('text')
                .attr('x', sx + (c + 1.5) * cellW).attr('y', y + 12)
                .attr('text-anchor', 'middle')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '9px').attr('fill', '#4b5563')
                .text(c);
        }

        for (let r = 0; r < maxRows; r++) {
            const ry = y + 18 + r * cellH;

            // Row label
            this.svg.append('text')
                .attr('x', sx + cellW / 2).attr('y', ry + cellH / 2)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '9px').attr('fill', '#4b5563')
                .text(r);

            for (let c = 0; c < maxCols && c < rows[r].length; c++) {
                const cx = sx + (c + 1) * cellW;
                const val = rows[r][c];

                this.svg.append('rect')
                    .attr('x', cx + 1).attr('y', ry + 1)
                    .attr('width', cellW - 2).attr('height', cellH - 2)
                    .attr('rx', 2)
                    .attr('fill', val === 1 ? 'rgba(75,143,239,0.08)' : '#1c1f28')
                    .attr('stroke', val === 1 ? 'rgba(75,143,239,0.25)' : '#2a2d37')
                    .attr('stroke-width', 1);

                this.svg.append('text')
                    .attr('x', cx + cellW / 2).attr('y', ry + cellH / 2)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                    .attr('font-size', '11px').attr('fill', '#d1d5db')
                    .text(val === null ? '∅' : val);
            }
        }
    },

    /* ═══════════════════════════════════════════════════════
       SET renderer
       ═══════════════════════════════════════════════════════ */
    _renderSet(struct, y, h) {
        const vals = struct.values;
        if (!vals || vals.length === 0) {
            this.svg.append('text')
                .attr('x', this.width / 2).attr('y', y + h / 2)
                .attr('text-anchor', 'middle')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '11px').attr('fill', '#4b5563')
                .text('∅');
            return;
        }

        const chipW = 40, chipH = 26, gap = 4;
        const maxChips = Math.min(vals.length, 20);
        const totalW = maxChips * (chipW + gap) - gap;
        const sx = (this.width - totalW) / 2;
        const cy = y + h / 2;

        vals.slice(0, maxChips).forEach((v, i) => {
            const cx = sx + i * (chipW + gap);
            this.svg.append('rect')
                .attr('x', cx).attr('y', cy - chipH / 2)
                .attr('width', chipW).attr('height', chipH)
                .attr('rx', 12)
                .attr('fill', '#1c1f28').attr('stroke', '#2a2d37');

            this.svg.append('text')
                .attr('x', cx + chipW / 2).attr('y', cy)
                .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '11px').attr('fill', '#d1d5db')
                .text(v);
        });
    },

    /* ═══════════════════════════════════════════════════════
       FALLBACK renderer — variable table
       ═══════════════════════════════════════════════════════ */
    _renderFallback(locals) {
        if (!locals) return;
        const keys = Object.keys(locals).filter(k => !k.startsWith('__'));
        const fallbackH = Math.max(this.height, 200);
        if (keys.length === 0) {
            this.svg.append('text')
                .attr('x', this.width / 2).attr('y', fallbackH / 2)
                .attr('text-anchor', 'middle')
                .attr('font-family', 'Inter, sans-serif')
                .attr('font-size', '12px').attr('fill', '#4b5563')
                .text('No data structures detected');
            return;
        }

        let ty = 36;
        this.svg.append('text')
            .attr('x', 20).attr('y', ty)
            .attr('font-family', 'Inter, sans-serif')
            .attr('font-size', '10px').attr('fill', '#6b7280')
            .attr('font-weight', 600).attr('letter-spacing', '0.6px')
            .text('VARIABLES');
        ty += 22;

        keys.forEach(k => {
            const val = typeof locals[k] === 'string'
                ? locals[k]
                : JSON.stringify(locals[k]);

            this.svg.append('text')
                .attr('x', 20).attr('y', ty)
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '12px').attr('fill', '#7ec8e3')
                .text(k);

            this.svg.append('text')
                .attr('x', 20 + k.length * 7.5 + 4).attr('y', ty)
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '12px').attr('fill', '#4b5563')
                .text('=');

            this.svg.append('text')
                .attr('x', 20 + k.length * 7.5 + 16).attr('y', ty)
                .attr('font-family', 'JetBrains Mono, Consolas, monospace')
                .attr('font-size', '12px').attr('fill', '#d1d5db')
                .text(val.length > 60 ? val.slice(0, 58) + '…' : val);

            ty += 22;
        });
    },

    /* ═══════════════════════════════════════════════════════
       Array comparison HUD
       ═══════════════════════════════════════════════════════ */
    _updateArrayHUD(struct, step) {
        const hud = document.getElementById('comparison-hud');
        if (!hud) return;

        const arr = struct.values;
        const arrName = struct.name;

        // Find pointers
        const pointers = [];
        if (step.locals) {
            for (const k in step.locals) {
                if (k === arrName || !this._isPointerName(k)) continue;
                const v = step.locals[k];
                if (typeof v === 'number' && Number.isInteger(v)
                    && v >= 0 && v < arr.length) {
                    pointers.push({ name: k, index: v });
                }
            }
        }

        // Scalars (non-pointer, non-array)
        const ptrNames = new Set(pointers.map(p => p.name));
        const scalars = [];
        for (const k in step.locals) {
            if (k === arrName || ptrNames.has(k)) continue;
            const v = step.locals[k];
            if (typeof v === 'number' || typeof v === 'string' ||
                typeof v === 'boolean' || v === null) {
                scalars.push({ name: k, value: v });
            }
        }

        const code = (step.code_text || '').trim();

        if (pointers.length >= 2 && arr &&
            (code.includes('sum') || code.includes('==') ||
             code.includes('<') || code.includes('>'))) {
            const p1 = pointers[0], p2 = pointers[1];
            const v1 = arr[p1.index], v2 = arr[p2.index];
            if (typeof v1 === 'number' && typeof v2 === 'number') {
                const sum = v1 + v2;
                const tgt = scalars.find(s => s.name === 'target');
                if (tgt !== undefined && tgt !== null && typeof tgt.value === 'number') {
                    let cls = 'eq', sym = '=';
                    if (sum < tgt.value) { cls = 'lt'; sym = '<'; }
                    else if (sum > tgt.value) { cls = 'gt'; sym = '>'; }
                    hud.innerHTML =
                        `<span class="val">${arrName}[${p1.index}]+${arrName}[${p2.index}]</span>` +
                        `<span class="op">=</span>` +
                        `<span class="val">${v1}+${v2}=${sum}</span>` +
                        `<span class="${cls}">${sym} ${tgt.value}</span>`;
                    hud.classList.add('visible');
                    return;
                }
            }
        }

        if (step.returned !== undefined) {
            hud.innerHTML = `<span class="eq">returned ${JSON.stringify(step.returned)}</span>`;
            hud.classList.add('visible');
            return;
        }

        this._hideHUD();
    },

    _hideHUD() {
        document.getElementById('comparison-hud')?.classList.remove('visible');
    },
};
