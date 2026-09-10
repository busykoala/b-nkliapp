import type { CorrelationPoint } from "@/features/statistics/model";

export function CorrelationPlot({ points, label, xLabel, yLabel }: { points: CorrelationPoint[]; label: string; xLabel: string; yLabel: string }) {
  const left = 42;
  const top = 15;
  const width = 476;
  const height = 206;
  const x = (value: number) => left + Math.max(0, Math.min(1, value / 720)) * width;
  const y = (value: number) => top + (1 - Math.max(0, Math.min(1, value / 100))) * height;
  return <figure className="lab-plot">
    <svg viewBox="0 0 540 260" role="img" aria-label={label}>
      <path className="lab-grid" d={`M${left} ${top}V${top + height}H${left + width} M${left} ${top + height / 2}H${left + width} M${left + width / 2} ${top}V${top + height}`} />
      {points.map((point) => <circle key={point.id} cx={x(point.winterSunMinutes)} cy={y(point.viewScore)} r="4.2"><title>{`${point.title ?? point.id}: ${Math.round(point.winterSunMinutes / 60)} h · ${Math.round(point.viewScore)}/100`}</title></circle>)}
      <text x={left + width / 2} y="252" textAnchor="middle">{xLabel}</text>
      <text x="13" y={top + height / 2} textAnchor="middle" transform={`rotate(-90 13 ${top + height / 2})`}>{yLabel}</text>
    </svg>
  </figure>;
}
