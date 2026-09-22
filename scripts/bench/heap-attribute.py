#!/usr/bin/env python3
"""Where the retained native allocations of a heapprofd trace came from.

    heap-attribute.py <trace.pftrace> [--count N] [--top K]

Prints net retained bytes (allocations minus frees over the whole trace) by
the first frame that is not an allocator, as KB per copy when --count is the
number of copies the plan mounted, plus an example call chain for each.
Needs the `perfetto` package (pip install perfetto; it fetches
trace_processor_shell on first use).
"""
import sys
from perfetto.trace_processor import TraceProcessor

args = sys.argv[1:]
if not args:
    sys.exit(__doc__)
path = args[0]
count = int(args[args.index('--count') + 1]) if '--count' in args else 1
top = int(args[args.index('--top') + 1]) if '--top' in args else 16

tp = TraceProcessor(trace=path)
frames = {r.id: (r.name or '?', r.mapping) for r in tp.query('select id, name, mapping from stack_profile_frame')}
maps = {r.id: (r.name or '?') for r in tp.query('select id, name from stack_profile_mapping')}
callsites = {r.id: (r.frame_id, r.parent_id) for r in tp.query('select id, frame_id, parent_id from stack_profile_callsite')}
rows = list(tp.query('select callsite_id, sum(count) as cnt, sum(size) as size from heap_profile_allocation group by callsite_id'))
total = sum(r.size for r in rows)

ALLOCATORS = ('malloc', 'calloc', 'realloc', 'operator new', '_Znwm', '_Znam', 'memalign', 'posix_memalign', 'strdup', 'je_', 'scudo', '__')

def chain(cid):
    out = []
    while cid is not None and cid in callsites:
        fid, parent = callsites[cid]
        name, m = frames.get(fid, ('?', None))
        out.append((name, maps.get(m, '?').split('/')[-1]))
        cid = parent
    return out

def owner(ch):
    for name, lib in ch:
        if lib.startswith('libc.so') or any(name.startswith(s) for s in ALLOCATORS):
            continue
        return (name, lib)
    return ('?', '?')

by_owner = {}
by_lib = {}
for r in rows:
    ch = chain(r.callsite_id)
    o = owner(ch)
    entry = by_owner.setdefault(o, [0, ' < '.join(n[:40] for n, _ in ch[:8])])
    entry[0] += r.size
    by_lib[o[1]] = by_lib.get(o[1], 0) + r.size

unit = f'KB per copy (count {count})' if count > 1 else 'KB'
print(f'net retained: {total / 1024 / 1024:.1f} MB = {total / 1024 / count:.1f} {unit}')
print('by library:')
for lib, size in sorted(by_lib.items(), key=lambda x: -x[1])[:10]:
    print(f'  {size / 1024 / count:9.1f} KB  {lib}')
print('by owner:')
for (fn, lib), (size, example) in sorted(by_owner.items(), key=lambda x: -x[1][0])[:top]:
    print(f'  {size / 1024 / count:9.1f} KB  {lib}: {fn[:80]}')
    print(f'                e.g. {example[:180]}')
