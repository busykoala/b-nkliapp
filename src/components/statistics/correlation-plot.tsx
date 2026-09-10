import type { CorrelationPoint } from "@/features/statistics/model";

export function CorrelationPlot({ points, trend, label, trendLabel, xLabel, yLabel }: {
  points: CorrelationPoint[];
  trend: { slope: number; intercept: number } | null;
  label: string;
  trendLabel: string;
  xLabel: string;
  yLabel: string;
}) {
  const left = 42;
  const top = 15;
  const width = 476;
  const height = 206;
  const extent = (values: number[]) => {
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const span = Math.max(1, maximum - minimum);
    return [minimum >= 0 ? 0 : minimum - span * .08, maximum + span * .08] as const;
  };
  const [xMinimum, xMaximum] = extent(points.map((point) => point.xValue));
  const [yMinimum, yMaximum] = extent(points.map((point) => point.yValue));
  const x = (value: number) => left + Math.max(0, Math.min(1, (value - xMinimum) / (xMaximum - xMinimum))) * width;
  const y = (value: number) => top + (1 - Math.max(0, Math.min(1, (value - yMinimum) / (yMaximum - yMinimum)))) * height;
  const trendY = (value: number) => y(trend ? trend.intercept + trend.slope * value : 0);
  return <figure className="lab-plot">
    <svg viewBox="0 0 540 260" role="img" aria-label={label}>
      <defs><clipPath id="correlation-field"><rect x={left} y={top} width={width} height={height} /></clipPath></defs>
      <path className="lab-grid" d={`M${left} ${top}V${top + height}H${left + width} M${left} ${top + height / 2}H${left + width} M${left + width / 2} ${top}V${top + height}`} />
      {points.map((point) => <circle key={point.id} cx={x(point.xValue)} cy={y(point.yValue)} r="5"><title>{`${point.title ?? point.id}: ${point.xValue.toFixed(1)} · ${point.yValue.toFixed(1)}`}</title></circle>)}
      {trend ? <line className="lab-trend" clipPath="url(#correlation-field)" x1={x(xMinimum)} y1={trendY(xMinimum)} x2={x(xMaximum)} y2={trendY(xMaximum)}><title>{trendLabel}</title></line> : null}
      <text x={left + width / 2} y="252" textAnchor="middle">{xLabel}</text>
      <text x="13" y={top + height / 2} textAnchor="middle" transform={`rotate(-90 13 ${top + height / 2})`}>{yLabel}</text>
    </svg>
    {trend ? <figcaption><i aria-hidden="true" /> {trendLabel}</figcaption> : null}
  </figure>;
}
