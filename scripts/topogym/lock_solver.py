"""Quasi-static lock model (1-degree grid) and BFS for the shortest macro-move solution.

State: z in {0.5,1,...,4,4.5} (integer z: tab k sits inside plate z-1-k; half-integer: all tabs between
plates), key angle phi, rotor angles th[0..2]. Plate 3 = fixed END plate.
Moves: at half-integer z the key turns freely; axial moves need every tab that enters/leaves a plate to be
inside one of that plate's slots (|phi-(th+s)| <= play); at integer z a turn drags each engaged rotor lazily
(keeps the tab within its slot), limited by rotor stops and the fixed END slot.
"""
import json, sys
from collections import deque

TIERS = {
    'easy':   dict(slots=[[-30, 0], [-30], [0]], stops=[[-15, 15], [-10, 45], [-180, 180]]),
    'medium': dict(slots=[[-60, -30, 0], [-60], [0]], stops=[[-15, 15], [-10, 75], [-180, 180]]),
    'hard':   dict(slots=[[-72, -48, -24, 0], [-72], [0]], stops=[[-12, 12], [-10, 87], [-180, 180]]),
}
PLAY = int(__import__("os").environ.get("LOCK_PLAY", "4"))  # slot half 8 - tab half 4 deg (search may use less)
END = 0             # endpoint_deg


def wrap(a):
    return (a + 180) % 360 - 180


def slot_of(plate, phi, th, slots):
    """Index of the slot that contains the tab (with play), else None."""
    if plate == 3:
        return 0 if abs(wrap(phi - END)) <= PLAY else None
    for k, s in enumerate(slots[plate]):
        if abs(wrap(phi - (th[plate] + s))) <= PLAY:
            return k
    return None


def engaged(z):
    if z != int(z):
        return []
    return [p for p in (int(z) - 1 - k for k in range(3)) if 0 <= p <= 3]


def solve(tier):
    cfg = TIERS[tier]
    slots, stops = cfg['slots'], cfg['stops']
    start = (0.5, 0, (0, 0, 0))
    prev = {start: None}
    q = deque([start])
    goal = None
    while q:
        state = q.popleft()
        z, phi, th = state
        if z == 4.5:
            goal = state
            break
        nxt = []
        if z != int(z):                          # free turn between plates
            for a in range(-180, 180):
                if a != phi:
                    nxt.append(((z, a, th), f'turn to {a:+d}'))
        else:                                    # dragging turn by 1 degree
            for d in (-1, 1):
                a = phi + d
                new = list(th)
                ok = True
                for p in engaged(z):
                    if p == 3:
                        ok &= abs(wrap(a - END)) <= PLAY
                        continue
                    k = slot_of(p, phi, th, slots)
                    s = slots[p][k]
                    lo, hi = stops[p]
                    t = new[p]
                    t = min(max(t, a - s - PLAY), a - s + PLAY)   # lazy push
                    full = hi - lo >= 360
                    if not full and not lo <= t <= hi:
                        ok = False
                    new[p] = wrap(t) if full else t
                if ok:
                    nxt.append(((z, wrap(a), tuple(new)), f'drag {d:+d}'))
        for dz in (-0.5, 0.5):                   # axial moves
            z2 = z + dz
            if not 0.5 <= z2 <= 4.5:
                continue
            plates = engaged(z2) if z2 == int(z2) else engaged(z)
            if all(slot_of(p, phi, th, slots) is not None for p in plates):
                nxt.append(((z2, phi, th), 'insert' if dz > 0 else 'retract'))
        for s2, label in nxt:
            if s2 not in prev:
                prev[s2] = (state, label)
                q.append(s2)
    path = []
    s = goal
    while prev[s] is not None:
        s0, label = prev[s]
        path.append((label, s))
        s = s0
    path.reverse()
    # compress consecutive drags / turns
    out = []
    for label, (z, phi, th) in path:
        kind = label.split()[0]
        if out and out[-1]['move'] == kind and kind in ('drag', 'turn'):
            out[-1].update(z=z, key_deg=phi, rotors_deg=list(th))
        else:
            out.append(dict(move=kind, z=z, key_deg=phi, rotors_deg=list(th)))
    return out, len(prev)


if __name__ == '__main__':
    result = {}
    for tier in TIERS:
        moves, explored = solve(tier)
        result[tier] = moves
        print(tier, 'explored', explored, 'states; macro moves', len(moves),
              'retracts', sum(m['move'] == 'retract' for m in moves))
        for m in moves:
            print('   ', m)
    json.dump(result, open(sys.argv[1] if len(sys.argv) > 1 else 'lock_solution.json', 'w'), indent=1)
