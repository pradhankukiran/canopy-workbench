import { useMemo } from "react";
import { ChartContainer } from "@/components/shared/chart-container";
import { chartColors, chartMargin, chartAxisStyles } from "@/lib/chart-theme";
import type { PricingYltDisplayRow } from "@/types/display";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import * as d3 from "d3";

interface LossDistributionProps {
  rows: PricingYltDisplayRow[];
  currency: string;
}

function LossDistribution({ rows, currency }: LossDistributionProps) {
  const bins = useMemo(() => {
    const losses = rows
      .map((r) => r.netLoss ?? r.grossLoss ?? 0)
      .filter((v) => v >= 0);
    if (losses.length === 0) return [];
    const histogram = d3.bin().thresholds(20);
    return histogram(losses);
  }, [rows]);

  if (bins.length === 0) return null;

  const maxCount = Math.max(...bins.map((b) => b.length));
  const xMin = bins[0]?.x0 ?? 0;
  const xMax = bins[bins.length - 1]?.x1 ?? 1;

  return (
    <ChartContainer
      title="Loss Distribution"
      description="Histogram of annual losses"
      height={300}
    >
      {({ width, height }) => {
        const m = chartMargin;
        const xRange = width - m.left - m.right;
        const yRange = height - m.top - m.bottom;

        const xScale = scaleLinear({
          domain: [xMin, xMax],
          range: [0, xRange],
        });
        const yScale = scaleLinear({
          domain: [0, maxCount * 1.1],
          range: [yRange, 0],
          nice: true,
        });

        return (
          <svg width={width} height={height}>
            <Group left={m.left} top={m.top}>
              {bins.map((bin, i) => {
                const x = xScale(bin.x0 ?? 0);
                const barWidth = Math.max(
                  1,
                  xScale(bin.x1 ?? 0) - x - 1
                );
                const barHeight = yRange - yScale(bin.length);
                const y = yScale(bin.length);

                return (
                  <Bar
                    key={i}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={chartColors.primary}
                    opacity={0.7}
                    rx={1}
                  />
                );
              })}
              <AxisBottom
                top={yRange}
                scale={xScale}
                label={`Loss (${currency})`}
                labelProps={chartAxisStyles.labelProps}
                tickLabelProps={() => chartAxisStyles.tickLabelProps}
                numTicks={5}
              />
              <AxisLeft
                scale={yScale}
                label="Frequency"
                labelProps={chartAxisStyles.labelProps}
                tickLabelProps={() => chartAxisStyles.tickLabelProps}
                numTicks={5}
              />
            </Group>
          </svg>
        );
      }}
    </ChartContainer>
  );
}

export default LossDistribution;
