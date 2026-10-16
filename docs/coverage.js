(async function () {
  const svg = document.getElementById("world-map");
  const tooltip = document.getElementById("map-tooltip");
  const listEl = document.getElementById("country-list");
  const svgNS = "http://www.w3.org/2000/svg";

  const [coverage, topology] = await Promise.all([
    fetch("data/coverage.json").then((r) => r.json()),
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then((r) => r.json()),
  ]);

  const byIso = new Map();
  for (const c of coverage.countries) byIso.set(String(c.iso), { ...c, kind: "covered" });
  for (const c of coverage.excluded) byIso.set(String(c.iso), { ...c, kind: "excluded" });

  const countries = topojson.feature(topology, topology.objects.countries);

  const width = 960;
  const height = 500;
  const projection = d3.geoEqualEarth().fitSize([width, height], countries);
  const path = d3.geoPath(projection);

  // Diagonal hatch pattern for excluded countries.
  const defs = document.createElementNS(svgNS, "defs");
  defs.innerHTML = `
    <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="#3a3a3a"></rect>
      <line x1="0" y1="0" x2="0" y2="6" stroke="#555" stroke-width="2"></line>
    </pattern>`;
  svg.appendChild(defs);

  const colorFor = (entry) => {
    if (!entry) return "#5a2222"; // not yet supported (red)
    if (entry.kind === "excluded") return "url(#hatch)";
    if (entry.status === "full") return "#3dff6e";
    return "#223527"; // partial - dots carry the detail
  };

  function showTooltip(html, evt) {
    tooltip.innerHTML = html;
    tooltip.classList.add("visible");
    moveTooltip(evt);
  }
  function moveTooltip(evt) {
    const pad = 14;
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + 260 > window.innerWidth) x = evt.clientX - 260 - pad;
    if (y + 120 > window.innerHeight) y = evt.clientY - 120 - pad;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }
  function hideTooltip() {
    tooltip.classList.remove("visible");
  }

  function countryTooltipHtml(name, entry) {
    if (!entry) {
      return `<strong>${name}</strong>Not yet supported. <a href="https://github.com/ker0s3ner/holdshort/issues" target="_blank">Request it on GitHub</a>.`;
    }
    if (entry.kind === "excluded") {
      return `<strong>${name}</strong>${entry.reason}`;
    }
    const list = entry.airports.map((a) => `<li>${a.icao} — ${a.name}</li>`).join("");
    const label = entry.status === "full" ? "Full coverage" : "Partial coverage";
    return `<strong>${name} — ${label}</strong><ul>${list}</ul>`;
  }

  const g = document.createElementNS(svgNS, "g");
  svg.appendChild(g);

  for (const feature of countries.features) {
    const iso = String(feature.id);
    const entry = byIso.get(iso);
    const d = path(feature);
    if (!d) continue;
    const el = document.createElementNS(svgNS, "path");
    el.setAttribute("d", d);
    el.setAttribute("class", "country-feature" + (entry && entry.kind === "excluded" ? " excluded" : ""));
    el.setAttribute("fill", colorFor(entry));
    const name = (feature.properties && feature.properties.name) || entry?.name || "Unknown";
    el.addEventListener("mousemove", (evt) => {
      showTooltip(countryTooltipHtml(entry?.name || name, entry), evt);
    });
    el.addEventListener("mouseleave", hideTooltip);
    g.appendChild(el);
  }

  // Yellow dots for each modeled airport in partially-covered countries.
  const dotsG = document.createElementNS(svgNS, "g");
  svg.appendChild(dotsG);
  for (const c of coverage.countries) {
    for (const a of c.airports) {
      if (a.lat == null || a.lon == null) continue;
      const pt = projection([a.lon, a.lat]);
      if (!pt) continue;
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", pt[0]);
      dot.setAttribute("cy", pt[1]);
      dot.setAttribute("r", c.status === "full" ? 1.4 : 2.2);
      dot.setAttribute("fill", c.status === "full" ? "#04120a" : "#ffcf5e");
      dot.setAttribute("stroke", c.status === "full" ? "none" : "#1a1400");
      dot.setAttribute("stroke-width", "0.4");
      dot.style.cursor = "help";
      dot.addEventListener("mousemove", (evt) => {
        showTooltip(`<strong>${a.icao}</strong>${a.name}, ${c.name}`, evt);
        evt.stopPropagation();
      });
      dot.addEventListener("mouseleave", hideTooltip);
      dotsG.appendChild(dot);
    }
  }

  svg.addEventListener("mousemove", (evt) => {
    if (tooltip.classList.contains("visible")) moveTooltip(evt);
  });

  // Full written list below the map, grouped the same way.
  const sections = [
    ["Full coverage", coverage.countries.filter((c) => c.status === "full")],
    ["Partial coverage", coverage.countries.filter((c) => c.status === "partial")],
    ["Excluded", coverage.excluded],
  ];
  let html = "";
  for (const [title, items] of sections) {
    if (!items.length) continue;
    html += `<h3>${title}</h3><div class="cards">`;
    for (const item of items) {
      if (item.reason) {
        html += `<div class="card"><h3>${item.name}</h3><p>${item.reason}</p></div>`;
      } else {
        const names = item.airports.map((a) => `${a.icao}`).join(", ");
        html += `<div class="card"><h3>${item.name}</h3><p>${item.airports.length} airport${item.airports.length === 1 ? "" : "s"}: ${names}</p></div>`;
      }
    }
    html += "</div>";
  }
  listEl.innerHTML = html;
})();
