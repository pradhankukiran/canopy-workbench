import { ChartContainer } from "@/components/shared/chart-container";
import { chartColors, chartMargin, chartAxisStyles } from "@/lib/chart-theme";
import { formatCurrency } from "@/lib/format";
import { AxisBottom } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear, scaleBand } from "@visx/scale";
import { Bar } from "@visx/shape";

interface PercentileBarProps {
  p50?: number;
  p90?: number;
  p99?: number;
  max?: number;
  currency: string;
}

function PercentileBar({ p50, p90, p99, max, currency }: PercentileBarProps) {
  const data = [
    { label: "P50", value: p50 },
    { label: "P90", value: p90 },
    { label: "P99", value: p99 },
    { label: "Max", value: max },
  ].filter((d): d is { label: string; value: number } => d.value != null);

  if (data.length === 0) return null;

  const maxValue = Math.max(...data.map((d) => d.value));

  return (
    <ChartContainer
      title="Loss Percentiles"
      description="P50, P90, P99, and maximum loss"
      height={180}
    >
      {({ width, height }) => {
        const m = { ...chartMargin, left: 50, bottom: 30 };
        const xMax = width - m.left - m.right;
        const yMax = height - m.top - m.bottom;

        const xScale = scaleLinear({
          domain: [0, maxValue * 1.15],
          range: [0, xMax],
        });
        const yScale = scaleBand({
          domain: data.map((d) => d.label),
          range: [0, yMax],
          padding: 0.35,
        });

        const barColors = [
          chartColors.primary,
          chartColors.primaryLight,
          chartColors.warning,
          chartColors.danger,
        ];

        return (
          <svg width={width} height={height}>
            <Group left={m.left} top={m.top}>
              {data.map((d, i) => {
                const y = yScale(d.label) ?? 0;
                const barWidth = xScale(d.value);
                const barHeight = yScale.bandwidth();

                return (
                  <g key={d.label}>
                    <Bar
                      x={0}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill={barColors[i % barColors.length]}
                      rx={3}
                    />
                    <text
                      x={-4}
                      y={y + barHeight / 2}
                      dy=".35em"
                      textAnchor="end"
                      fontSize={11}
                      fill="#334155"
                      fontWeight={600}
                    >
                      {d.label}
                    </text>
                    <text
                      x={barWidth + 6}
                      y={y + barHeight / 2}
                      dy=".35em"
                      fontSize={10}
                      fill="#667085"
                    >
                      {formatCurrency(d.value, currency)}
                    </text>
                  </g>
                );
              })}
              <AxisBottom
                top={yMax}
                scale={xScale}
                tickLabelProps={() => chartAxisStyles.tickLabelProps}
                numTicks={4}
                tickFormat={(v) => formatCurrency(v as number, currency)}
              />
            </Group>
          </svg>
        );
      }}
    </ChartContainer>
  );
}

export default PercentileBar;
