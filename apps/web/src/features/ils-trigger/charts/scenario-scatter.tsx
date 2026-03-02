import { ChartContainer } from "@/components/shared/chart-container";
import { chartColors, chartMargin, chartAxisStyles } from "@/lib/chart-theme";
import type { IlsTriggerSimulationDisplayRow } from "@/types/display";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";

interface ScenarioScatterProps {
  rows: IlsTriggerSimulationDisplayRow[];
}

function ScenarioScatter({ rows }: ScenarioScatterProps) {
  const validRows = rows.filter(
    (r) =>
      typeof r.triggerIndexValue === "number" &&
      typeof r.payoutPct === "number"
  );

  if (validRows.length === 0) return null;

  const indexValues = validRows.map((r) => r.triggerIndexValue!);
  const payoutPcts = validRows.map((r) => r.payoutPct!);

  const xMin = Math.min(...indexValues) * 0.9;
  const xMax = Math.max(...indexValues) * 1.1;
  const yMax = Math.min(1.05, Math.max(...payoutPcts) * 1.1);

  return (
    <ChartContainer
      title="Scenario Scatter"
      description="Index value vs payout percentage, colored by trigger status"
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
          domain: [0, yMax],
          range: [yRange, 0],
        });

        return (
          <svg width={width} height={height}>
            <Group left={m.left} top={m.top}>
              <GridRows
                scale={yScale}
                width={xRange}
                stroke={chartColors.grid}
                strokeDasharray="3,3"
              />
              <GridColumns
                scale={xScale}
                height={yRange}
                stroke={chartColors.grid}
                strokeDasharray="3,3"
              />
              {validRows.map((r, i) => (
                <circle
                  key={i}
                  cx={xScale(r.triggerIndexValue!)}
                  cy={yScale(r.payoutPct!)}
                  r={3}
                  fill={
                    r.exhausted
                      ? chartColors.exhausted
                      : r.triggered
                        ? chartColors.triggered
                        : chartColors.notTriggered
                  }
                  opacity={0.6}
                />
              ))}
              <AxisBottom
                top={yRange}
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
                tickFormat={(v) =>
                  `${Math.round((v as number) * 100)}%`
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

export default ScenarioScatter;
