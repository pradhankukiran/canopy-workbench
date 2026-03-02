import { useMemo } from "react";
import { ChartContainer } from "@/components/shared/chart-container";
import { chartColors, chartMargin, chartAxisStyles } from "@/lib/chart-theme";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";

interface TriggerResponseCurveProps {
  attachmentThreshold: number;
  exhaustionThreshold: number;
}

function TriggerResponseCurve({
  attachmentThreshold,
  exhaustionThreshold,
}: TriggerResponseCurveProps) {
  const data = useMemo(() => {
    const min = Math.max(0, attachmentThreshold * 0.5);
    const max = exhaustionThreshold * 1.3;
    const steps = 100;
    const range = max - min;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const indexValue = min + (range * i) / steps;
      let payout = 0;
      if (indexValue >= exhaustionThreshold) {
        payout = 1;
      } else if (indexValue > attachmentThreshold) {
        payout =
          (indexValue - attachmentThreshold) /
          (exhaustionThreshold - attachmentThreshold);
      }
      return { indexValue, payout };
    });
  }, [attachmentThreshold, exhaustionThreshold]);

  return (
    <ChartContainer
      title="Trigger Response Curve"
      description="Payout percentage vs index value"
      height={300}
    >
      {({ width, height }) => {
        const m = chartMargin;
        const xMax = width - m.left - m.right;
        const yMax = height - m.top - m.bottom;

        const xScale = scaleLinear({
          domain: [data[0].indexValue, data[data.length - 1].indexValue],
          range: [0, xMax],
        });
        const yScale = scaleLinear({
          domain: [0, 1.05],
          range: [yMax, 0],
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
              {/* Threshold lines */}
              <line
                x1={xScale(attachmentThreshold)}
                x2={xScale(attachmentThreshold)}
                y1={0}
                y2={yMax}
                stroke={chartColors.warning}
                strokeDasharray="4,4"
                strokeWidth={1.5}
              />
              <line
                x1={xScale(exhaustionThreshold)}
                x2={xScale(exhaustionThreshold)}
                y1={0}
                y2={yMax}
                stroke={chartColors.danger}
                strokeDasharray="4,4"
                strokeWidth={1.5}
              />
              <LinePath
                data={data}
                x={(d) => xScale(d.indexValue)}
                y={(d) => yScale(d.payout)}
                stroke={chartColors.primary}
                strokeWidth={2.5}
              />
              <AxisBottom
                top={yMax}
                scale={xScale}
                label="Index Value"
                labelProps={chartAxisStyles.labelProps}
                tickLabelProps={() => chartAxisStyles.tickLabelProps}
                numTicks={6}
              />
              <AxisLeft
                scale={yScale}
                label="Payout %"
                labelProps={chartAxisStyles.labelProps}
                tickLabelProps={() => chartAxisStyles.tickLabelProps}
                tickFormat={(v) => `${Math.round((v as number) * 100)}%`}
                numTicks={5}
              />
            </Group>
          </svg>
        );
      }}
    </ChartContainer>
  );
}

export default TriggerResponseCurve;
