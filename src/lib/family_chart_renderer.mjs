const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const pct = (value, digits = 2) => {
  const n = num(value)
  if (!Number.isFinite(n)) return "n/a"
  return `${(n * 100).toFixed(digits)}%`
}

const fixed = (value, digits = 2) => {
  const n = num(value)
  if (!Number.isFinite(n)) return "n/a"
  return n.toFixed(digits)
}

const palette = {
  bg: "#07111f",
  panel: "#0c1c30",
  panelAlt: "#0f2239",
  grid: "#27415d",
  text: "#d7e2f0",
  muted: "#7f96af",
  up: "#ff5a66",
  down: "#4aa8ff",
  wick: "#c6d2e3",
  volumeUp: "#ff8a93",
  volumeDown: "#7cc4ff",
  event: "#ffd166",
  ma5: "#f4d35e",
  ma10: "#ee964b",
  ma20: "#9bdeac",
  ma60: "#69b7ff",
  ma120: "#b392f0",
  consensusMean: "#72f1b8",
  consensusRep: "#ffd166",
  band: "rgba(114, 241, 184, 0.18)"
}

const renderPriceGrid = ({ x, y, width, height, min, max, ticks = 5 }) => {
  const lines = []
  for (let i = 0; i < ticks; i += 1) {
    const ratio = ticks === 1 ? 0 : i / (ticks - 1)
    const yy = y + height * ratio
    const price = max - (max - min) * ratio
    lines.push(
      `<line x1="${x}" y1="${yy}" x2="${x + width}" y2="${yy}" stroke="${palette.grid}" stroke-opacity="0.55" stroke-width="1"/>`,
    )
    lines.push(
      `<text x="${x - 14}" y="${yy + 4}" fill="${palette.muted}" font-size="13" text-anchor="end">${esc(
        fixed(price, 0),
      )}</text>`,
    )
  }
  return lines.join("")
}

const renderVolumeGrid = ({ x, y, width, height, maxVolume }) =>
  [
    `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="${palette.grid}" stroke-opacity="0.55" stroke-width="1"/>`,
    `<line x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}" stroke="${palette.grid}" stroke-opacity="0.55" stroke-width="1"/>`,
    `<text x="${x - 14}" y="${y + 4}" fill="${palette.muted}" font-size="13" text-anchor="end">${esc(
      fixed(maxVolume / 1_000_000, 1),
    )}M</text>`
  ].join("")

const buildLinePath = (points) => {
  let started = false
  const parts = []
  for (const point of points) {
    const xx = num(point?.x)
    const yy = num(point?.y)
    if (!Number.isFinite(xx) || !Number.isFinite(yy)) {
      started = false
      continue
    }
    if (!started) {
      parts.push(`M ${xx} ${yy}`)
      started = true
    } else {
      parts.push(`L ${xx} ${yy}`)
    }
  }
  return parts.join(" ")
}

const renderDateLabels = ({ candles, x, y, width, slot }) => {
  const count = Array.isArray(candles) ? candles.length : 0
  if (!count) return ""
  const steps = Math.min(6, count)
  const lines = []
  for (let i = 0; i < steps; i += 1) {
    const idx = Math.min(count - 1, Math.round((i * (count - 1)) / Math.max(1, steps - 1)))
    const candle = candles[idx]
    const xx = x + slot * idx + slot / 2
    lines.push(
      `<text x="${xx}" y="${y}" fill="${palette.muted}" font-size="12" text-anchor="middle">${esc(
        String(candle?.dateKey ?? "").slice(5),
      )}</text>`,
    )
  }
  return lines.join("")
}

export const renderCandlestickChartSvg = ({
  family,
  representative,
  candles,
  maPeriods = [5, 10, 20, 60, 120],
  title = "",
  subtitle = ""
}) => {
  const safeCandles = Array.isArray(candles) ? candles.filter(Boolean) : []
  if (!safeCandles.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720" viewBox="0 0 1600 720"><rect width="100%" height="100%" fill="${palette.bg}"/><text x="60" y="120" fill="${palette.text}" font-size="32">No candle data</text></svg>`
  }

  const width = 1600
  const height = 880
  const margin = { top: 88, right: 54, bottom: 78, left: 86 }
  const priceHeight = 520
  const volumeHeight = 150
  const gap = 22
  const chartWidth = width - margin.left - margin.right
  const priceY = margin.top
  const volumeY = margin.top + priceHeight + gap
  const slot = chartWidth / safeCandles.length
  const bodyWidth = Math.max(3, Math.min(14, slot * 0.68))

  let minPrice = Infinity
  let maxPrice = -Infinity
  let maxVolume = 0
  for (const candle of safeCandles) {
    minPrice = Math.min(minPrice, num(candle?.low) ?? Infinity)
    maxPrice = Math.max(maxPrice, num(candle?.high) ?? -Infinity)
    maxVolume = Math.max(maxVolume, num(candle?.volume) ?? 0)
    for (const period of maPeriods) {
      const maValue = num(candle?.[`ma${period}`])
      if (Number.isFinite(maValue)) {
        minPrice = Math.min(minPrice, maValue)
        maxPrice = Math.max(maxPrice, maValue)
      }
    }
  }
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice === maxPrice) {
    minPrice = 0
    maxPrice = 1
  }
  const pricePad = (maxPrice - minPrice) * 0.08
  minPrice -= pricePad
  maxPrice += pricePad

  const yPrice = (value) => {
    const n = num(value)
    if (!Number.isFinite(n)) return null
    return priceY + ((maxPrice - n) / Math.max(1e-9, maxPrice - minPrice)) * priceHeight
  }
  const yVolume = (value) => {
    const n = num(value)
    if (!Number.isFinite(n) || maxVolume <= 0) return volumeY + volumeHeight
    return volumeY + ((maxVolume - n) / maxVolume) * volumeHeight
  }

  const candleMarks = []
  const maPoints = Object.fromEntries(maPeriods.map((period) => [period, []]))
  let eventMarkerX = null
  for (let idx = 0; idx < safeCandles.length; idx += 1) {
    const candle = safeCandles[idx]
    const x = margin.left + idx * slot + slot / 2
    const open = num(candle?.open)
    const high = num(candle?.high)
    const low = num(candle?.low)
    const close = num(candle?.close)
    const volume = num(candle?.volume)
    const up = Number.isFinite(open) && Number.isFinite(close) ? close >= open : true
    const color = up ? palette.up : palette.down
    const wickY1 = yPrice(high)
    const wickY2 = yPrice(low)
    const bodyY1 = yPrice(Math.max(open ?? close ?? 0, close ?? open ?? 0))
    const bodyY2 = yPrice(Math.min(open ?? close ?? 0, close ?? open ?? 0))
    const bodyHeight = Math.max(1.8, Math.abs((bodyY2 ?? 0) - (bodyY1 ?? 0)))
    const bodyTop = Math.min(bodyY1 ?? 0, bodyY2 ?? 0)
    candleMarks.push(
      `<line x1="${x}" y1="${wickY1}" x2="${x}" y2="${wickY2}" stroke="${palette.wick}" stroke-width="1.35"/>`,
    )
    candleMarks.push(
      `<rect x="${x - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight}" rx="1.2" fill="${color}" stroke="${color}" stroke-width="1"/>`,
    )
    const volY = yVolume(volume)
    candleMarks.push(
      `<rect x="${x - bodyWidth / 2}" y="${volY}" width="${bodyWidth}" height="${volumeY + volumeHeight - volY}" fill="${
        up ? palette.volumeUp : palette.volumeDown
      }" opacity="0.86"/>`,
    )
    for (const period of maPeriods) {
      maPoints[period].push({
        x,
        y: yPrice(candle?.[`ma${period}`])
      })
    }
    if (String(candle?.dateKey ?? "") === String(representative?.eventDate ?? "")) {
      eventMarkerX = x
    }
  }

  const maColors = {
    5: palette.ma5,
    10: palette.ma10,
    20: palette.ma20,
    60: palette.ma60,
    120: palette.ma120
  }
  const maMarks = maPeriods
    .map((period) => {
      const path = buildLinePath(maPoints[period])
      if (!path) return ""
      return `<path d="${path}" fill="none" stroke="${maColors[period] ?? palette.text}" stroke-width="${
        period >= 60 ? 2.1 : 1.8
      }" stroke-linecap="round" stroke-linejoin="round" opacity="${period >= 60 ? 0.9 : 0.96}"/>`
    })
    .join("")

  const legend = maPeriods
    .map(
      (period, idx) =>
        `<g transform="translate(${margin.left + idx * 118}, 36)"><line x1="0" y1="0" x2="24" y2="0" stroke="${
          maColors[period] ?? palette.text
        }" stroke-width="3"/><text x="32" y="5" fill="${palette.text}" font-size="15">${period}D MA</text></g>`,
    )
    .join("")

  const eventMarker =
    eventMarkerX === null
      ? ""
      : [
          `<line x1="${eventMarkerX}" y1="${priceY - 8}" x2="${eventMarkerX}" y2="${volumeY + volumeHeight}" stroke="${palette.event}" stroke-width="1.4" stroke-dasharray="6 6"/>`,
          `<rect x="${eventMarkerX - 48}" y="${priceY - 42}" width="96" height="24" rx="12" fill="${palette.event}" fill-opacity="0.16" stroke="${palette.event}" stroke-width="1"/>`,
          `<text x="${eventMarkerX}" y="${priceY - 25}" fill="${palette.event}" font-size="13" text-anchor="middle">EVENT DAY</text>`
        ].join("")

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="${palette.bg}"/>`,
    `<rect x="24" y="22" width="${width - 48}" height="${height - 44}" rx="26" fill="${palette.panel}" stroke="${palette.grid}" stroke-width="1.2"/>`,
    `<text x="${margin.left}" y="48" fill="${palette.text}" font-size="32" font-weight="700">${esc(title)}</text>`,
    `<text x="${margin.left}" y="72" fill="${palette.muted}" font-size="16">${esc(subtitle)}</text>`,
    legend,
    `<rect x="${margin.left}" y="${priceY}" width="${chartWidth}" height="${priceHeight}" rx="18" fill="${palette.panelAlt}"/>`,
    `<rect x="${margin.left}" y="${volumeY}" width="${chartWidth}" height="${volumeHeight}" rx="18" fill="${palette.panelAlt}"/>`,
    renderPriceGrid({ x: margin.left, y: priceY, width: chartWidth, height: priceHeight, min: minPrice, max: maxPrice }),
    renderVolumeGrid({ x: margin.left, y: volumeY, width: chartWidth, height: volumeHeight, maxVolume }),
    maMarks,
    candleMarks.join(""),
    eventMarker,
    renderDateLabels({
      candles: safeCandles,
      x: margin.left,
      y: volumeY + volumeHeight + 28,
      width: chartWidth,
      slot
    }),
    `</svg>`
  ].join("")
}

export const renderConsensusChartSvg = ({
  family,
  consensusLocal,
  consensusGlobal,
  title = ""
}) => {
  const width = 1600
  const height = 560
  const margin = { top: 70, right: 60, bottom: 56, left: 68 }
  const panelGap = 26
  const panelHeight = 180
  const chartWidth = width - margin.left - margin.right
  const firstY = margin.top
  const secondY = firstY + panelHeight + panelGap

  const buildSeriesBounds = (series) => {
    let min = Infinity
    let max = -Infinity
    for (const value of series?.mean ?? []) {
      const n = num(value)
      if (!Number.isFinite(n)) continue
      min = Math.min(min, n)
      max = Math.max(max, n)
    }
    for (const value of series?.representative ?? []) {
      const n = num(value)
      if (!Number.isFinite(n)) continue
      min = Math.min(min, n)
      max = Math.max(max, n)
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = -1
      max = 1
    }
    const pad = (max - min) * 0.12
    return { min: min - pad, max: max + pad }
  }

  const renderPanel = ({ panel, top, label }) => {
    const mean = Array.isArray(panel?.mean) ? panel.mean : []
    const rep = Array.isArray(panel?.representative) ? panel.representative : []
    const stdev = Array.isArray(panel?.stdev) ? panel.stdev : []
    const count = Math.max(mean.length, rep.length)
    if (!count) return ""
    const { min, max } = buildSeriesBounds(panel)
    const xAt = (idx) => margin.left + (idx / Math.max(1, count - 1)) * chartWidth
    const yAt = (value) => top + ((max - value) / Math.max(1e-9, max - min)) * panelHeight
    const meanPoints = []
    const repPoints = []
    const bandUpper = []
    const bandLower = []
    for (let idx = 0; idx < count; idx += 1) {
      const x = xAt(idx)
      const meanValue = num(mean[idx])
      const repValue = num(rep[idx])
      const dev = num(stdev[idx]) ?? 0
      meanPoints.push({ x, y: yAt(meanValue ?? 0) })
      repPoints.push({ x, y: yAt(repValue ?? 0) })
      bandUpper.push(`${x},${yAt((meanValue ?? 0) + dev)}`)
      bandLower.push(`${x},${yAt((meanValue ?? 0) - dev)}`)
    }
    const bandPath = `${bandUpper.join(" ")} ${bandLower.reverse().join(" ")}`
    return [
      `<rect x="${margin.left}" y="${top}" width="${chartWidth}" height="${panelHeight}" rx="18" fill="${palette.panelAlt}"/>`,
      `<text x="${margin.left}" y="${top - 12}" fill="${palette.text}" font-size="18" font-weight="700">${esc(
        label,
      )}</text>`,
      `<polygon points="${bandPath}" fill="${palette.band}" stroke="none"/>`,
      `<path d="${buildLinePath(meanPoints)}" fill="none" stroke="${palette.consensusMean}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>`,
      `<path d="${buildLinePath(repPoints)}" fill="none" stroke="${palette.consensusRep}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" opacity="0.92"/>`,
      `<line x1="${margin.left}" y1="${top + panelHeight / 2}" x2="${margin.left + chartWidth}" y2="${top + panelHeight / 2}" stroke="${palette.grid}" stroke-width="1" stroke-opacity="0.5"/>`
    ].join("")
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="${palette.bg}"/>`,
    `<rect x="24" y="22" width="${width - 48}" height="${height - 44}" rx="26" fill="${palette.panel}" stroke="${palette.grid}" stroke-width="1.2"/>`,
    `<text x="${margin.left}" y="46" fill="${palette.text}" font-size="30" font-weight="700">${esc(title)}</text>`,
    `<text x="${margin.left}" y="68" fill="${palette.muted}" font-size="15">Consensus mean in green, representative overlay in gold</text>`,
    renderPanel({ panel: consensusLocal, top: firstY, label: "Local pattern / seq40" }),
    renderPanel({ panel: consensusGlobal, top: secondY, label: "Global context / seq150" }),
    `</svg>`
  ].join("")
}

const renderMetric = (label, value) =>
  `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div></div>`

export const renderFamilyHtml = ({
  family,
  representative,
  explanation,
  representativeChartFile,
  consensusChartFile,
  shortlistRank
}) => {
  const metrics = [
    ["Rank", `#${shortlistRank}`],
    ["Family", family?.familyId ?? "n/a"],
    ["Support", String(family?.support ?? "n/a")],
    ["Symbols", String(family?.symbolCount ?? "n/a")],
    ["C0 score", fixed(family?.c0Score, 3)],
    ["Era coverage", pct(family?.eraCoverageRatio)],
    ["Regime coverage", pct(family?.regimeCoverageRatio)],
    ["Shape cohesion", fixed(family?.shapeCohesionScore, 3)],
    ["Representative", representative?.templateId ?? "n/a"],
    ["Rep similarity", fixed(representative?.representativeMeanSimilarity, 3)]
  ]
  const bulletItems = (Array.isArray(explanation?.bullets) ? explanation.bullets : [])
    .map((item) => `<li>${esc(item)}</li>`)
    .join("")

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(family?.familyId ?? "family")} chart report</title>
  <style>
    :root {
      --bg: ${palette.bg};
      --panel: ${palette.panel};
      --panel-alt: ${palette.panelAlt};
      --line: ${palette.grid};
      --text: ${palette.text};
      --muted: ${palette.muted};
      --accent: ${palette.event};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px;
      background:
        radial-gradient(circle at top left, rgba(255, 209, 102, 0.12), transparent 34%),
        linear-gradient(180deg, #08111e 0%, #07111f 100%);
      color: var(--text);
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    }
    .shell {
      max-width: 1680px;
      margin: 0 auto;
      display: grid;
      gap: 18px;
    }
    .hero, .panel {
      border: 1px solid rgba(39, 65, 93, 0.9);
      background: rgba(12, 28, 48, 0.94);
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
    }
    .hero {
      padding: 22px 24px 18px;
      display: grid;
      gap: 10px;
    }
    .eyebrow {
      color: var(--accent);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 12px;
    }
    h1 {
      margin: 0;
      font-size: 36px;
      line-height: 1.05;
      font-family: Georgia, "Times New Roman", serif;
    }
    .sub {
      color: var(--muted);
      max-width: 960px;
      line-height: 1.6;
      font-size: 15px;
    }
    .grid {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    .metrics {
      display: grid;
      gap: 10px;
      padding: 18px;
    }
    .metric {
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(15, 34, 57, 0.96);
      border: 1px solid rgba(39, 65, 93, 0.82);
    }
    .metric-label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
    }
    .metric-value {
      margin-top: 4px;
      font-size: 18px;
      font-weight: 700;
    }
    .chart-wrap {
      padding: 16px;
    }
    .chart-wrap img {
      width: 100%;
      display: block;
      border-radius: 18px;
      border: 1px solid rgba(39, 65, 93, 0.82);
      background: var(--bg);
    }
    .notes {
      padding: 18px 20px 22px;
      line-height: 1.7;
    }
    .notes h2 {
      margin: 0 0 10px;
      font-size: 18px;
      font-family: Georgia, "Times New Roman", serif;
    }
    .notes ul {
      margin: 0;
      padding-left: 22px;
    }
    .tags {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .tag {
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(39, 65, 93, 0.82);
      color: var(--muted);
      font-size: 12px;
      background: rgba(15, 34, 57, 0.92);
    }
    @media (max-width: 1120px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="eyebrow">C0 family representative chart</div>
      <h1>${esc(family?.familyId ?? "family")} · ${esc(explanation?.headline ?? "Representative stock pattern")}</h1>
      <div class="sub">${esc(explanation?.summary ?? "Representative raw price chart and family consensus view.")}</div>
      <div class="tags">${(Array.isArray(explanation?.tags) ? explanation.tags : [])
        .map((tag) => `<span class="tag">${esc(tag)}</span>`)
        .join("")}</div>
    </section>
    <section class="panel grid">
      <div class="metrics">${metrics.map(([label, value]) => renderMetric(label, value)).join("")}</div>
      <div class="chart-wrap"><img src="${esc(representativeChartFile)}" alt="${esc(
        family?.familyId ?? "family",
      )} representative chart" /></div>
    </section>
    <section class="panel">
      <div class="chart-wrap"><img src="${esc(consensusChartFile)}" alt="${esc(
        family?.familyId ?? "family",
      )} consensus chart" /></div>
    </section>
    <section class="panel notes">
      <h2>Pattern notes</h2>
      <ul>${bulletItems}</ul>
    </section>
  </div>
</body>
</html>`
}

export const renderIndexHtml = ({ families, title, subtitle }) => {
  const cards = (Array.isArray(families) ? families : [])
    .map(
      (family) => `<a class="card" href="${esc(family?.pageFile ?? "#")}">
        <div class="card-meta">#${esc(family?.shortlistRank ?? "")} · ${esc(family?.familyId ?? "")}</div>
        <h2>${esc(family?.headline ?? "Representative family")}</h2>
        <div class="card-sub">${esc(family?.summary ?? "")}</div>
        <div class="card-stats">
          <span>support ${esc(String(family?.support ?? "n/a"))}</span>
          <span>symbols ${esc(String(family?.symbolCount ?? "n/a"))}</span>
          <span>score ${esc(fixed(family?.c0Score, 3))}</span>
        </div>
        <img src="${esc(family?.previewFile ?? "")}" alt="${esc(family?.familyId ?? "")} preview" />
      </a>`,
    )
    .join("")

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root {
      --bg: ${palette.bg};
      --panel: ${palette.panel};
      --line: ${palette.grid};
      --text: ${palette.text};
      --muted: ${palette.muted};
      --accent: ${palette.event};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      background:
        radial-gradient(circle at top left, rgba(255, 209, 102, 0.12), transparent 32%),
        linear-gradient(180deg, #07111f 0%, #091425 100%);
      color: var(--text);
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    }
    .shell {
      max-width: 1680px;
      margin: 0 auto;
      display: grid;
      gap: 20px;
    }
    .hero {
      border: 1px solid rgba(39, 65, 93, 0.9);
      background: rgba(12, 28, 48, 0.94);
      border-radius: 28px;
      padding: 24px 28px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
    }
    .eyebrow {
      color: var(--accent);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 12px;
    }
    h1 {
      margin: 10px 0 8px;
      font-size: 42px;
      line-height: 1.04;
      font-family: Georgia, "Times New Roman", serif;
    }
    .sub {
      color: var(--muted);
      max-width: 1024px;
      line-height: 1.7;
      font-size: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 18px;
    }
    .card {
      display: grid;
      gap: 10px;
      color: inherit;
      text-decoration: none;
      border: 1px solid rgba(39, 65, 93, 0.9);
      background: rgba(12, 28, 48, 0.96);
      border-radius: 24px;
      padding: 18px;
      box-shadow: 0 18px 56px rgba(0, 0, 0, 0.18);
      transition: transform 180ms ease, border-color 180ms ease;
    }
    .card:hover {
      transform: translateY(-4px);
      border-color: rgba(255, 209, 102, 0.52);
    }
    .card-meta {
      color: var(--accent);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: 12px;
    }
    .card h2 {
      margin: 0;
      font-size: 26px;
      line-height: 1.12;
      font-family: Georgia, "Times New Roman", serif;
    }
    .card-sub {
      color: var(--muted);
      line-height: 1.6;
      min-height: 52px;
    }
    .card-stats {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .card-stats span {
      padding: 6px 8px;
      border-radius: 999px;
      border: 1px solid rgba(39, 65, 93, 0.82);
      background: rgba(15, 34, 57, 0.92);
    }
    .card img {
      width: 100%;
      display: block;
      border-radius: 18px;
      border: 1px solid rgba(39, 65, 93, 0.82);
      background: var(--bg);
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="eyebrow">C0 shortlisted family chart atlas</div>
      <h1>${esc(title)}</h1>
      <div class="sub">${esc(subtitle)}</div>
    </section>
    <section class="grid">${cards}</section>
  </div>
</body>
</html>`
}
