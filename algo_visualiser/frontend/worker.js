/* ═══════════════════════════════════════════════════════════
   Pyodide Web Worker — runs Python tracer in browser sandbox
   ═══════════════════════════════════════════════════════════ */

// The full tracer.py source, embedded as a string
const TRACER_SOURCE = `
import sys
import copy
import json
import typing
import collections
import math
from collections import deque

MAX_STEPS = 2000


class Tracer:
    def __init__(self, source_lines):
        self.steps = []
        self.source_lines = source_lines
        self.prev_locals = {}

    def trace_calls(self, frame, event, arg):
        if event != 'call':
            return
        if frame.f_code.co_filename == '<string>':
            return self.trace_lines
        return None

    def trace_lines(self, frame, event, arg):
        if event == 'line':
            if frame.f_code.co_filename == '<string>':
                if len(self.steps) >= MAX_STEPS:
                    sys.settrace(None)
                    return None

                raw = dict(frame.f_locals)
                current_locals = self._serialize_locals(raw)
                lineno = frame.f_lineno

                changes = []
                for key in current_locals:
                    if key not in self.prev_locals:
                        changes.append(key)
                    elif current_locals[key] != self.prev_locals[key]:
                        changes.append(key)

                code_text = ''
                if 0 < lineno <= len(self.source_lines):
                    code_text = self.source_lines[lineno - 1].rstrip()

                explanation = self._build_explanation(
                    code_text, current_locals, changes, lineno
                )

                structures = self._detect_structures(raw)

                self.steps.append({
                    'line': lineno,
                    'locals': current_locals,
                    'changes': changes,
                    'code_text': code_text,
                    'explanation': explanation,
                    'structures': structures,
                })

                self.prev_locals = copy.deepcopy(current_locals)

        if event == 'return':
            if frame.f_code.co_filename == '<string>':
                raw = dict(frame.f_locals)
                current_locals = self._serialize_locals(raw)
                ret_val = self._serialize_value(arg)
                lineno = frame.f_lineno
                code_text = ''
                if 0 < lineno <= len(self.source_lines):
                    code_text = self.source_lines[lineno - 1].rstrip()

                structures = self._detect_structures(raw)

                self.steps.append({
                    'line': lineno,
                    'locals': current_locals,
                    'changes': [],
                    'code_text': code_text,
                    'explanation': 'Return: ' + json.dumps(ret_val),
                    'returned': ret_val,
                    'structures': structures,
                })

        return self.trace_lines

    # -- Structure Detection --
    def _detect_structures(self, raw_locals):
        structs = []
        seen_names = set()
        seen_ids = set()

        active_ids = set()
        for name, val in raw_locals.items():
            if name.startswith('__') or name == 'self':
                continue
            if hasattr(val, '__dict__') and not isinstance(val, type) and not callable(val):
                active_ids.add(id(val))

        if 'self' in raw_locals:
            obj = raw_locals['self']
            if hasattr(obj, '__dict__'):
                for attr, val in obj.__dict__.items():
                    if not attr.startswith('_'):
                        self._classify(
                            attr, val, structs, seen_names, seen_ids, active_ids
                        )

        for name, val in raw_locals.items():
            if name == 'self' or name.startswith('__'):
                continue
            self._classify(name, val, structs, seen_names, seen_ids, active_ids)

        return structs

    def _classify(self, name, val, structs, seen_names, seen_ids, active_ids):
        if name in seen_names:
            return
        try:
            if isinstance(val, (list, deque)):
                seen_names.add(name)
                items = list(val)
                if (len(items) > 0
                        and all(isinstance(r, (list, deque)) for r in items)):
                    structs.append({
                        'type': 'matrix', 'name': name,
                        'rows': [[self._prim(x) for x in r] for r in items]
                    })
                else:
                    structs.append({
                        'type': 'array', 'name': name,
                        'values': [self._prim(x) for x in items]
                    })

            elif isinstance(val, dict):
                seen_names.add(name)
                entries = []
                for k, v in val.items():
                    e = {'key': self._prim(k), 'value': self._brief(v)}
                    if hasattr(v, '__dict__') and not isinstance(v, type):
                        e['active'] = id(v) in active_ids
                    entries.append(e)
                structs.append({
                    'type': 'hashmap', 'name': name, 'entries': entries
                })

            elif isinstance(val, (set, frozenset)):
                seen_names.add(name)
                structs.append({
                    'type': 'set', 'name': name,
                    'values': sorted([self._prim(x) for x in val], key=str)
                })

            elif self._is_ll_node(val):
                if id(val) not in seen_ids:
                    nodes, nids = self._walk_list(val, active_ids)
                    seen_ids.update(nids)
                    if len(nodes) >= 2:
                        seen_names.add(name)
                        structs.append({
                            'type': 'linked_list', 'name': name, 'nodes': nodes
                        })

            elif self._is_tree_node(val):
                if id(val) not in seen_ids:
                    root, tids = self._walk_tree(val)
                    seen_ids.update(tids)
                    if root:
                        seen_names.add(name)
                        structs.append({
                            'type': 'tree', 'name': name, 'root': root
                        })

            elif (hasattr(val, '__dict__') and not isinstance(val, type)
                  and not callable(val)):
                if id(val) not in seen_ids:
                    seen_ids.add(id(val))
                    for a, v in val.__dict__.items():
                        if not a.startswith('_'):
                            self._classify(
                                name + '.' + a, v, structs,
                                seen_names, seen_ids, active_ids
                            )
        except Exception:
            pass

    def _is_ll_node(self, obj):
        return (hasattr(obj, 'next')
                and not isinstance(obj, (type, str, bytes))
                and not callable(obj))

    def _is_tree_node(self, obj):
        return (hasattr(obj, 'left') and hasattr(obj, 'right')
                and not hasattr(obj, 'next')
                and not isinstance(obj, (type, str, bytes))
                and not callable(obj))

    def _walk_list(self, head, active_ids, limit=20):
        nodes, visited = [], set()
        cur = head
        while (cur is not None
               and not isinstance(cur, (int, float, str, bool))
               and id(cur) not in visited
               and len(nodes) < limit):
            visited.add(id(cur))
            fields = self._node_fields(cur)
            is_sentinel = (
                (len(fields) == 0
                 or all(v == 0 or v is None for v in fields.values()))
                and id(cur) not in active_ids
            )
            nodes.append({
                'id': str(id(cur)),
                'fields': fields,
                'active': id(cur) in active_ids,
                'sentinel': is_sentinel,
            })
            nxt = getattr(cur, 'next', None)
            if nxt is None or isinstance(nxt, (int, float, str, bool)):
                break
            cur = nxt
        return nodes, visited

    def _walk_tree(self, root, limit=31, _visited=None):
        if _visited is None:
            _visited = set()
        if root is None or isinstance(root, (int, float, str, bool)):
            return None, _visited
        if not (hasattr(root, 'left') or hasattr(root, 'right')):
            return None, _visited
        if id(root) in _visited or len(_visited) >= limit:
            return None, _visited

        _visited.add(id(root))

        val = None
        for attr in ('val', 'value', 'key', 'data', 'x'):
            if hasattr(root, attr):
                v = getattr(root, attr)
                if isinstance(v, (int, float, str, bool, type(None))):
                    val = v
                    break

        left, _visited = self._walk_tree(
            getattr(root, 'left', None), limit, _visited
        )
        right, _visited = self._walk_tree(
            getattr(root, 'right', None), limit, _visited
        )
        return {
            'id': str(id(root)), 'val': val,
            'left': left, 'right': right
        }, _visited

    def _node_fields(self, obj):
        fields = {}
        for attr in ('key', 'val', 'value', 'data', 'x', 'freq', 'count'):
            if hasattr(obj, attr):
                v = getattr(obj, attr)
                if isinstance(v, (int, float, str, bool, type(None))):
                    fields[attr] = v
        return fields

    def _prim(self, val):
        if isinstance(val, (int, float, str, bool, type(None))):
            return val
        return str(val)

    def _brief(self, val):
        if isinstance(val, (int, float, str, bool, type(None))):
            return val
        if isinstance(val, (list, deque)):
            return '[' + str(len(val)) + ']'
        if isinstance(val, dict):
            return '{' + str(len(val)) + '}'
        if hasattr(val, '__dict__') and not isinstance(val, type):
            cls = val.__class__.__name__
            f = self._node_fields(val)
            if f:
                return cls + '(' + ','.join(str(v) for v in f.values()) + ')'
            return cls
        return str(val)[:20]

    def _build_explanation(self, code_text, locals_dict, changes, lineno):
        stripped = code_text.strip()
        if not stripped or stripped.startswith('#'):
            return ''

        if '=' in stripped and not any(
            stripped.startswith(kw) for kw in (
                'if', 'elif', 'while', 'for', 'return', 'def', 'class'
            )
        ) and '==' not in stripped:
            parts = stripped.split('=', 1)
            var_name = parts[0].strip()
            if var_name in locals_dict:
                val = locals_dict[var_name]
                return 'Set ' + var_name + ' = ' + json.dumps(val)

        if stripped.startswith('if ') or stripped.startswith('elif '):
            condition = stripped.split(' ', 1)[1].rstrip(':')
            return 'Check condition: ' + condition

        if stripped.startswith('while '):
            condition = stripped.split(' ', 1)[1].rstrip(':')
            return 'Loop condition: ' + condition

        if stripped.startswith('for '):
            return 'Loop: ' + stripped.rstrip(':')

        if stripped.startswith('return'):
            return 'Returning result'

        if '+=' in stripped or '-=' in stripped:
            op = '+=' if '+=' in stripped else '-='
            var_name = stripped.split(op)[0].strip()
            if var_name in locals_dict:
                return 'Update ' + var_name + ' -> ' + json.dumps(locals_dict[var_name])

        if changes:
            descs = [
                c + ' = ' + json.dumps(locals_dict[c])
                for c in changes if c in locals_dict
            ]
            if descs:
                return 'Changed: ' + ', '.join(descs)

        return 'Execute: ' + stripped

    def _serialize_locals(self, locals_dict):
        clean = {}
        for k, v in locals_dict.items():
            if k == 'self':
                continue
            if (not k.startswith('__')
                    and not callable(v)
                    and not isinstance(v, type)
                    and not isinstance(v, type(sys))):
                clean[k] = self._serialize_value(v)
        return clean

    def _serialize_value(self, obj, depth=0):
        if depth > 4:
            return '...'
        if isinstance(obj, (int, float, str, bool, type(None))):
            if isinstance(obj, float):
                import math
                if math.isinf(obj):
                    return "Infinity" if obj > 0 else "-Infinity"
                if math.isnan(obj):
                    return "NaN"
            return obj
        elif isinstance(obj, (list, deque)):
            return [self._serialize_value(x, depth + 1) for x in list(obj)[:50]]
        elif isinstance(obj, tuple):
            return [self._serialize_value(x, depth + 1) for x in obj[:50]]
        elif isinstance(obj, dict):
            return {
                str(k): self._serialize_value(v, depth + 1)
                for k, v in list(obj.items())[:50]
            }
        elif isinstance(obj, (set, frozenset)):
            return sorted(
                [self._serialize_value(x, depth + 1) for x in list(obj)[:50]],
                key=str
            )
        elif hasattr(obj, '__dict__') and not isinstance(obj, type):
            cls = obj.__class__.__name__
            f = self._node_fields(obj)
            if f:
                parts = ', '.join(
                    str(k) + '=' + str(v) for k, v in list(f.items())[:3]
                )
                return cls + '(' + parts + ')'
            return cls + '()'
        return str(obj)[:30]


def run_code(code_string):
    source_lines = code_string.splitlines()
    tracer = Tracer(source_lines)

    # Pre-inject common LeetCode imports into namespace
    namespace = {}
    for name in dir(typing):
        if not name.startswith('_'):
            try:
                namespace[name] = getattr(typing, name)
            except Exception:
                pass
    for name in ['defaultdict', 'deque', 'Counter', 'OrderedDict', 'namedtuple']:
        if hasattr(collections, name):
            namespace[name] = getattr(collections, name)
    namespace['math'] = math
    namespace['inf'] = float('inf')

    sys.settrace(tracer.trace_calls)
    try:
        exec(code_string, namespace)
    except Exception as e:
        sys.settrace(None)
        return {
            'error': str(e),
            'steps': tracer.steps,
            'source': source_lines,
        }
    finally:
        sys.settrace(None)

    # Auto-detect class Solution with no instantiation
    if 'Solution' in namespace:
        has_call = any('Solution(' in line for line in source_lines)
        if not has_call:
            cls = namespace.get('Solution')
            if cls:
                for name, func in cls.__dict__.items():
                    if not name.startswith('_') and callable(func):
                        try:
                            import inspect
                            sig = inspect.signature(func)
                            dummy_args = []
                            for p_name, param in list(sig.parameters.items())[1:]: # skip self
                                ant = str(param.annotation).lower()
                                if 'list' in ant and 'str' in ant: dummy_args.append('["a","b","c"]')
                                elif 'list' in ant: dummy_args.append('[1,2,3,4,5]')
                                elif 'str' in ant: dummy_args.append('"hello"')
                                elif 'bool' in ant: dummy_args.append('True')
                                else: dummy_args.append('2')
                            
                            hint = f'Solution().{name}({", ".join(dummy_args)})'
                            auto_code = code_string + "\\n\\n# Auto-generated test case\\n" + hint
                            return run_code(auto_code)
                        except Exception:
                            pass
            
            # Fallback if inspect fails
            import re
            methods = re.findall(r'def\\s+(\\w+)\\s*\\(\\s*self', code_string)
            methods = [m for m in methods if m != '__init__']
            if methods:
                hint = 'Solution().' + methods[0] + '(args)'
                return {
                    'error': 'Found class Solution but no function call. Add a call at the bottom, e.g.: ' + hint,
                    'steps': [],
                    'source': source_lines,
                }

    step_warning = ''
    if len(tracer.steps) >= MAX_STEPS:
        step_warning = ' (truncated at ' + str(MAX_STEPS) + ' steps)'

    return {'error': None, 'steps': tracer.steps, 'source': source_lines}
`;

let pyodide = null;
let ready = false;

// ── Load Pyodide ──────────────────────────────────────────
async function initPyodide() {
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');

    self.postMessage({ type: 'status', message: 'Loading Python runtime...' });

    pyodide = await loadPyodide();

    self.postMessage({ type: 'status', message: 'Initializing tracer...' });

    // Load the tracer module into Pyodide
    pyodide.runPython(TRACER_SOURCE);

    ready = true;
    self.postMessage({ type: 'ready' });
}

// ── Run user code through the tracer ──────────────────────
async function runTrace(code) {
    if (!ready) {
        self.postMessage({
            type: 'result',
            data: { error: 'Python environment not ready yet', steps: [], source: [] }
        });
        return;
    }

    try {
        // Pass the user's code to the tracer
        pyodide.globals.set('__user_code__', code);
        const resultJson = pyodide.runPython(`
import json
result = run_code(__user_code__)
json.dumps(result)
        `);
        const data = JSON.parse(resultJson);
        self.postMessage({ type: 'result', data });
    } catch (err) {
        self.postMessage({
            type: 'result',
            data: {
                error: err.message || String(err),
                steps: [],
                source: code.split('\n')
            }
        });
    }
}

// ── Message handler ───────────────────────────────────────
self.onmessage = async function (e) {
    const { type, code } = e.data;
    if (type === 'run') {
        await runTrace(code);
    }
};

// Start loading immediately
initPyodide();
