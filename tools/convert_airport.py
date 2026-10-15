import json
import math
import sys

def parse_width(value):
    """OSM width tags are free-text and sometimes carry units (e.g. '61',
    '61 m', '200 ft'); normalize to meters where we can, else drop it."""
    if value is None:
        return None
    text = str(value).strip().lower()
    feet = text.endswith("ft")
    text = text.replace("m", "").replace("ft", "").strip()
    try:
        num = float(text)
    except ValueError:
        return None
    return round(num * 0.3048, 2) if feet else num


def load(path):
    with open(path) as f:
        return json.load(f)

def main(src_path, icao, name, out_path):
    d = load(src_path)
    els = d["elements"]
    nodes = {e["id"]: e for e in els if e["type"] == "node"}
    ways = [e for e in els if e["type"] == "way"]

    # Reference point = centroid of runway nodes (stable, real-world anchor)
    runway_ways = [w for w in ways if w.get("tags", {}).get("aeroway") == "runway"]
    ref_lats = []
    ref_lons = []
    for w in runway_ways:
        for nid in w["nodes"]:
            n = nodes.get(nid)
            if n:
                ref_lats.append(n["lat"])
                ref_lons.append(n["lon"])
    ref_lat = sum(ref_lats) / len(ref_lats)
    ref_lon = sum(ref_lons) / len(ref_lons)

    R = 6378137.0  # meters, WGS84 equatorial radius

    def to_xy(lat, lon):
        # Equirectangular projection, local tangent plane, meters.
        x = math.radians(lon - ref_lon) * R * math.cos(math.radians(ref_lat))
        y = math.radians(lat - ref_lat) * R
        return x, y

    out_nodes = {}
    for nid, n in nodes.items():
        x, y = to_xy(n["lat"], n["lon"])
        out_nodes[str(nid)] = {
            "id": str(nid),
            "lat": n["lat"],
            "lon": n["lon"],
            "x": round(x, 2),
            "y": round(y, 2),
        }

    used_node_ids = set()
    edges = []
    edge_id = 0

    def add_edges_for_way(w, kind, ref):
        nonlocal edge_id
        wnodes = w["nodes"]
        for a, b in zip(wnodes, wnodes[1:]):
            if a not in nodes or b not in nodes:
                continue
            used_node_ids.add(a)
            used_node_ids.add(b)
            na, nb = out_nodes[str(a)], out_nodes[str(b)]
            length = math.hypot(na["x"] - nb["x"], na["y"] - nb["y"])
            edge_id += 1
            edges.append({
                "id": f"e{edge_id}",
                "from": str(a),
                "to": str(b),
                "kind": kind,
                "ref": ref,
                "length_m": round(length, 2),
            })

    runway_meta = {}  # ref -> {"width":.., "surface":.., "segments": [[node_ids...], ...]}
    for w in ways:
        t = w.get("tags", {})
        aeroway = t.get("aeroway")
        if aeroway == "runway":
            add_edges_for_way(w, "runway", t.get("ref", ""))
            ref = t.get("ref", "")
            meta = runway_meta.setdefault(ref, {"width": parse_width(t.get("width")), "surface": t.get("surface"), "segments": []})
            meta["segments"].append([n for n in w["nodes"] if n in nodes])
        elif aeroway in ("taxiway", "taxilane"):
            add_edges_for_way(w, aeroway, t.get("ref", ""))
        elif aeroway == "stopway":
            add_edges_for_way(w, "stopway", t.get("ref", ""))

    # A real-world runway is sometimes mapped as several way segments that
    # meet at shared nodes (e.g. a pavement/marking break). Merge them per
    # ref and take the two true physical thresholds: the nodes that appear
    # only once across all of that runway's segment endpoints.
    runways = []
    for ref, meta in runway_meta.items():
        # Skip runway ways OSM left untagged or without a proper "A/B"
        # identifier pair - not usable as a named ATC runway end.
        if "/" not in ref:
            continue
        endpoint_counts = {}
        for seg in meta["segments"]:
            if not seg:
                continue
            for nid in (seg[0], seg[-1]):
                endpoint_counts[nid] = endpoint_counts.get(nid, 0) + 1
        thresholds = [nid for nid, c in endpoint_counts.items() if c == 1]
        if len(thresholds) != 2:
            # Fallback: single segment or unexpected topology, use its ends.
            seg = meta["segments"][0]
            thresholds = [seg[0], seg[-1]]
        n0, n1 = out_nodes[str(thresholds[0])], out_nodes[str(thresholds[1])]
        brg = (math.degrees(math.atan2(n1["x"] - n0["x"], n1["y"] - n0["y"])) + 360) % 360
        runways.append({
            "ref": ref,
            "ends": ref.split("/"),
            "width_m": meta["width"],
            "surface": meta["surface"],
            "node_start": str(thresholds[0]),
            "node_end": str(thresholds[1]),
            "heading_deg": round(brg, 1),
        })

    parking = []
    for w in ways:
        t = w.get("tags", {})
        if t.get("aeroway") == "parking_position":
            wnodes = [n for n in w["nodes"] if n in nodes]
            if not wnodes:
                continue
            nid = wnodes[0]
            used_node_ids.add(nid)
            parking.append({
                "id": str(nid),
                "ref": t.get("ref", t.get("name", "")),
                "node": str(nid),
                "parking_type": t.get("parking_position", "gate"),
            })
    for n in els:
        if n["type"] == "node":
            t = n.get("tags", {})
            if t.get("aeroway") == "parking_position":
                used_node_ids.add(n["id"])
                parking.append({
                    "id": str(n["id"]),
                    "ref": t.get("ref", t.get("name", "")),
                    "node": str(n["id"]),
                    "parking_type": t.get("parking_position", "gate"),
                })

    pruned_nodes = {nid: out_nodes[nid] for nid in out_nodes if int(nid) in used_node_ids}

    # Connect isolated parking positions to the nearest node already reachable
    # on the taxiway/apron graph, so every gate is routable.
    parent = {nid: nid for nid in pruned_nodes}

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for e in edges:
        union(e["from"], e["to"])

    groups = {}
    for nid in pruned_nodes:
        groups.setdefault(find(nid), []).append(nid)
    main_group = max(groups.values(), key=len)
    main_set = set(main_group)

    link_id = 0
    for p in parking:
        pid = p["node"]
        if pid in main_set:
            continue
        pn = pruned_nodes[pid]
        best, best_d = None, None
        for nid in main_group:
            n = pruned_nodes[nid]
            dist = math.hypot(n["x"] - pn["x"], n["y"] - pn["y"])
            if best_d is None or dist < best_d:
                best, best_d = nid, dist
        if best is not None:
            link_id += 1
            edges.append({
                "id": f"glink{link_id}",
                "from": pid,
                "to": best,
                "kind": "gate_link",
                "ref": "",
                "length_m": round(best_d, 2),
            })
            union(pid, best)
            main_group.append(pid)
            main_set.add(pid)

    result = {
        "icao": icao,
        "name": name,
        "reference_point": {"lat": ref_lat, "lon": ref_lon},
        "attribution": "Surface layout derived from OpenStreetMap contributors data, ODbL.",
        "nodes": list(pruned_nodes.values()),
        "edges": edges,
        "runways": runways,
        "parking_positions": parking,
    }

    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"nodes={len(pruned_nodes)} edges={len(edges)} runways={len(runways)} parking={len(parking)}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
