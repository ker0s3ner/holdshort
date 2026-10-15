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
            # Some runways carry their "09/27"-style identifier under
            # `name` instead of `ref` - accept either.
            ref = t.get("ref") or t.get("name") or ""
            add_edges_for_way(w, "runway", ref)
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

    # Building/apron footprints: visual-only polygons (not part of the
    # routing graph), so they carry their own inline x/y rather than
    # referencing the pruned node set.
    areas = []
    for w in ways:
        t = w.get("tags", {})
        aeroway = t.get("aeroway")
        if aeroway not in ("terminal", "hangar", "apron"):
            continue
        wnodes = [n for n in w["nodes"] if n in nodes]
        if len(wnodes) < 3:
            continue
        points = [[out_nodes[str(n)]["x"], out_nodes[str(n)]["y"]] for n in wnodes]
        areas.append({"kind": aeroway, "points": points})

    towers = []
    for w in ways:
        t = w.get("tags", {})
        if t.get("aeroway") != "tower":
            continue
        wnodes = [n for n in w["nodes"] if n in nodes]
        if not wnodes:
            continue
        xs = [out_nodes[str(n)]["x"] for n in wnodes]
        ys = [out_nodes[str(n)]["y"] for n in wnodes]
        height = parse_width(t.get("height"))
        towers.append({
            "x": round(sum(xs) / len(xs), 2),
            "y": round(sum(ys) / len(ys), 2),
            "height_m": height if height is not None else 30.0,
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

    # Plenty of real airports (especially smaller/regional ones) have an
    # apron mapped in OSM but never got individual parking_position stands
    # tagged within it. Rather than ship a surface with taxiways and no
    # gates at all - which the sim can't spawn traffic into - synthesize
    # evenly-spaced stands around each apron's perimeter and link each one
    # back to the nearest real taxiway/runway node.
    if not parking:
        taxiway_node_ids = list(pruned_nodes.keys())
        apron_polys = [a for a in areas if a["kind"] == "apron"]
        synthetic_id = 0
        for poly in apron_polys:
            pts = poly["points"]
            n = len(pts)
            if n < 3 or not taxiway_node_ids:
                continue
            perimeter = sum(
                math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1])
                for i in range(n)
            )
            spacing = 35.0
            count = max(0, min(10, int(perimeter / spacing)))
            if count < 2:
                continue
            cx = sum(p[0] for p in pts) / n
            cy = sum(p[1] for p in pts) / n
            for k in range(count):
                target = (k / count) * perimeter
                acc = 0.0
                px, py = pts[0]
                for i in range(n):
                    ax, ay = pts[i]
                    bx, by = pts[(i + 1) % n]
                    seg = math.hypot(bx - ax, by - ay)
                    if seg > 0 and (acc + seg >= target or i == n - 1):
                        frac = max(0.0, min(1.0, (target - acc) / seg))
                        px, py = ax + (bx - ax) * frac, ay + (by - ay) * frac
                        break
                    acc += seg
                dirx, diry = cx - px, cy - py
                dlen = math.hypot(dirx, diry) or 1
                px += dirx / dlen * 5.0
                py += diry / dlen * 5.0

                synthetic_id += 1
                sid = f"synstand{synthetic_id}"
                local_y = py / R * (180 / math.pi)
                local_x = px / (R * math.cos(math.radians(ref_lat))) * (180 / math.pi)
                pruned_nodes[sid] = {
                    "id": sid,
                    "lat": ref_lat + local_y,
                    "lon": ref_lon + local_x,
                    "x": round(px, 2),
                    "y": round(py, 2),
                }
                best, best_d = None, None
                for nid in taxiway_node_ids:
                    node = pruned_nodes[nid]
                    d = math.hypot(node["x"] - px, node["y"] - py)
                    if best_d is None or d < best_d:
                        best, best_d = nid, d
                if best is not None:
                    edges.append({
                        "id": f"synlink{synthetic_id}",
                        "from": sid,
                        "to": best,
                        "kind": "gate_link",
                        "ref": "",
                        "length_m": round(best_d, 2),
                    })
                parking.append({
                    "id": sid,
                    "ref": f"STAND {synthetic_id}",
                    "node": sid,
                    "parking_type": "gate",
                })

    # Some OSM parking_position points sit directly on a taxiway/taxilane
    # centerline node rather than offset into the actual stand - this makes
    # aircraft spawn "on" the taxiway visually. Nudge those onto a synthetic
    # stand node just off the pavement, linked back in by a short connector
    # (toward the nearest apron/terminal footprint when we have one, so the
    # offset lands on the ramp rather than into a building or the grass).
    taxi_edge_dirs = {}
    for e in edges:
        if e["kind"] not in ("taxiway", "taxilane", "runway", "stopway"):
            continue
        a, b = e["from"], e["to"]
        na, nb = pruned_nodes[a], pruned_nodes[b]
        dx, dy = nb["x"] - na["x"], nb["y"] - na["y"]
        length = math.hypot(dx, dy) or 1
        dx, dy = dx / length, dy / length
        taxi_edge_dirs.setdefault(a, []).append((dx, dy))
        taxi_edge_dirs.setdefault(b, []).append((dx, dy))

    STAND_OFFSET_M = 18.0
    area_centroids = [
        (
            sum(pt[0] for pt in a["points"]) / len(a["points"]),
            sum(pt[1] for pt in a["points"]) / len(a["points"]),
        )
        for a in areas
        if a["kind"] in ("apron", "terminal")
    ]

    def nearest_area_dist(pt):
        return min(math.hypot(pt[0] - cx, pt[1] - cy) for cx, cy in area_centroids)

    for p in parking:
        nid = p["node"]
        dirs = taxi_edge_dirs.get(nid)
        if not dirs:
            continue
        dx, dy = dirs[0]
        perp = (-dy, dx)
        base = pruned_nodes[nid]
        cand_a = (base["x"] + perp[0] * STAND_OFFSET_M, base["y"] + perp[1] * STAND_OFFSET_M)
        cand_b = (base["x"] - perp[0] * STAND_OFFSET_M, base["y"] - perp[1] * STAND_OFFSET_M)
        if area_centroids:
            chosen = cand_a if nearest_area_dist(cand_a) <= nearest_area_dist(cand_b) else cand_b
        else:
            chosen = cand_a

        stand_id = f"{nid}_stand"
        local_y = chosen[1] / R * (180 / math.pi)
        local_x = chosen[0] / (R * math.cos(math.radians(ref_lat))) * (180 / math.pi)
        pruned_nodes[stand_id] = {
            "id": stand_id,
            "lat": ref_lat + local_y,
            "lon": ref_lon + local_x,
            "x": round(chosen[0], 2),
            "y": round(chosen[1], 2),
        }
        edges.append({
            "id": f"standlink{nid}",
            "from": stand_id,
            "to": nid,
            "kind": "gate_link",
            "ref": "",
            "length_m": STAND_OFFSET_M,
        })
        p["node"] = stand_id

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

    # OSM taxiway geometry sometimes has small digitizing gaps - two
    # centerlines that should meet but don't quite share a node - which
    # leaves whole taxiway/apron clusters disconnected from the main
    # pavement network and makes them look unfinished/missing when
    # rendered. Heal gaps up to a conservative distance by bridging the
    # closest node pair between a stray cluster and the main network.
    SNAP_THRESHOLD_M = 60.0
    link_id = 0
    for _ in range(50):
        groups = {}
        for nid in pruned_nodes:
            groups.setdefault(find(nid), []).append(nid)
        if len(groups) <= 1:
            break
        main_group = max(groups.values(), key=len)
        main_set = set(main_group)
        other_groups = [g for g in groups.values() if g is not main_group and len(g) > 1]
        if not other_groups:
            break
        fragment = max(other_groups, key=len)

        best_a, best_b, best_d = None, None, None
        for fid in fragment:
            fn = pruned_nodes[fid]
            for mid in main_group:
                mn = pruned_nodes[mid]
                dist = math.hypot(mn["x"] - fn["x"], mn["y"] - fn["y"])
                if best_d is None or dist < best_d:
                    best_a, best_b, best_d = fid, mid, dist
        if best_d is None or best_d > SNAP_THRESHOLD_M:
            # Can't bridge this fragment safely - mark it "done" by
            # merging it into main_set bookkeeping only, not the graph,
            # so the loop moves on to the next fragment instead of
            # retrying this one forever.
            union(fragment[0], main_group[0])
            continue

        link_id += 1
        edges.append({
            "id": f"gap{link_id}",
            "from": best_a,
            "to": best_b,
            "kind": "taxiway",
            "ref": "",
            "length_m": round(best_d, 2),
        })
        union(best_a, best_b)

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
        "areas": areas,
        "towers": towers,
    }

    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"nodes={len(pruned_nodes)} edges={len(edges)} runways={len(runways)} parking={len(parking)} areas={len(areas)} towers={len(towers)}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
