import { ChartContainer } from "@/components/shared/chart-container";
import { chartColors, chartMargin, chartAxisStyles } from "@/lib/chart-theme";
import { formatCurrency } from "@/lib/format";
import type { ReturnPeriodPoint } from "@/types/api";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLog, scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";

interface LossExceedanceCurveProps {
  oep?: ReturnPeriodPoint[];
  aep?: ReturnPeriodPoint[];
  currency: string;
}

function LossExceedanceCurve({
  oep = [],
  aep = [],
  currency,
}: LossExceedanceCurveProps) {
  const allPoints = [...oep, ...aep];
  if (allPoints.length === 0) return null;

  const allRp = allPoints.map((p) => p.returnPeriodYears).filter((v) => v > 0);
  const allLoss = allPoints
    .flatMap((p) => [p.grossLoss, p.netLoss, p.bondPayout])
    .filter((v): v is number => typeof v === "number" && v >= 0);

  if (allRp.length === 0 || allLoss.length === 0) return null;

  const rpMin = Math.max(1, Math.min(...allRp));
  const rpMax = Math.max(10, Math.max(...allRp));
  const lossMax = Math.max(1, Math.max(...allLoss));

  return (
    <ChartContainer
      title="Loss Exceedance Curve"
      description="OEP and AEP loss by return period"
      height={300}
    >
      {({ width, height }) => {
        const m = chartMargin;
        const xMax = width - m.left - m.right;
        const yMax = height - m.top - m.bottom;

        const xScale = scaleLog({
          domain: [rpMin, rpMax],
          range: [0, xMax],
          base: 10,
        });
        const yScale = scaleLinear({
          domain: [0, lossMax * 1.1],
          range: [yMax, 0],
          nice: true,
        });

        return (
          <svg width={width} height={height}>
            <Group left={m.left} top={m.top}>
              <GridRows
                scale={yScale}
                width={xMax}
                stroke={chartColors.grid}
                strokeDasharray="3,3"
              />
              {oep.length > 0 && (
                <LinePath
                  data={oep}
                  x={(d) => xScale(d.returnPeriodYears)}
                  y={(d) => yScale(d.netLoss ?? d.grossLoss ?? 0)}
                  stroke={chartColors.oep}
                  strokeWidth={2}
                />
              )}
              {aep && aep.length > 0 && (
                <LinePath
                  data={aep}
                  x={(d) => xScale(d.returnPeriodYears)}
                  y={(d) => yScale(d.netLoss ?? d.grossLoss ?? 0)}
                  stroke={chartColors.aep}
                  strokeWidth={2}
                  strokeDasharray="4,4"
                />
              )}
              <AxisBottom
                top={yMax}
                scale={xScale}
                label="Return Period (years)"
                labelProps={chartAxisStyles.labelProps}
                tickLabelProps={() => chartAxisStyles.tickLabelProps}
                numTicks={5}
              />
              <AxisLeft
                scale={yScale}
                label={`Loss (${currency})`}
                labelProps={chartAxisStyles.labelProps}
                tickLabelProps={() => chartAxisStyles.tickLabelProps}
                tickFormat={(v) =>
                  formatCurrency(v as number, currency)
                }
                numTicks={5}
              />
            </Group>
          </svg>
        );
      }}
    </ChartContainer>
  );
}

export default LossExceedanceCurve;
