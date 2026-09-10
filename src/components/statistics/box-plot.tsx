import type { BoxPlotGroup } from "@/features/statistics/model";

export function BoxPlot({ groups, label, title, description, groupLabel }: {
  groups: BoxPlotGroup[];
  label: string;
  title: string;
  description: string;
  groupLabel: (group: BoxPlotGroup) => string;
}) {
  const top = 14;
  const height = 172;
  const values = groups.flatMap((group) => [group.minimum, group.maximum]);
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const span = Math.max(1, rawMaximum - rawMinimum);
  const minimum = rawMinimum >= 0 ? 0 : rawMinimum - span * .08;
  const maximum = rawMaximum + span * .08;
  const y = (value: number) => top + (1 - Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)))) * height;
  const ticks = [minimum + (maximum - minimum) * .25, minimum + (maximum - minimum) * .5, minimum + (maximum - minimum) * .75];
  const compact = (value: number) => Math.abs(value) >= 1_000 ? `${Math.round(value / 1_000)}k` : Number(value.toFixed(1));
  return <figure className="box-plot">
    <figcaption><strong>{title}</strong><span>{description}</span></figcaption>
    <svg viewBox="0 0 540 238" role="img" aria-label={label}>
      {ticks.map((value) => <g key={value}><line className="box-grid" x1="34" x2="524" y1={y(value)} y2={y(value)} /><text x="27" y={y(value) + 4} textAnchor="end">{compact(value)}</text></g>)}
      {groups.map((group, index) => {
        const x = 92 + index * 126;
        const boxTop = y(group.upperQuartile);
        const boxHeight = Math.max(2, y(group.lowerQuartile) - boxTop);
        return <g className="box-group" key={group.quartile}>
          <line className="box-whisker" x1={x} x2={x} y1={y(group.maximum)} y2={y(group.minimum)} />
          <line className="box-whisker" x1={x - 15} x2={x + 15} y1={y(group.maximum)} y2={y(group.maximum)} />
          <line className="box-whisker" x1={x - 15} x2={x + 15} y1={y(group.minimum)} y2={y(group.minimum)} />
          <rect className="box-body" x={x - 29} y={boxTop} width="58" height={boxHeight} rx="5" />
          <line className="box-median" x1={x - 29} x2={x + 29} y1={y(group.median)} y2={y(group.median)} />
          <text className="box-quartile" x={x} y="207" textAnchor="middle">Q{group.quartile}</text>
          <text className="box-range" x={x} y="224" textAnchor="middle">{groupLabel(group)}</text>
          <title>{`${groupLabel(group)} · ${group.count} · ${compact(group.minimum)}–${compact(group.maximum)}`}</title>
        </g>;
      })}
    </svg>
  </figure>;
}
