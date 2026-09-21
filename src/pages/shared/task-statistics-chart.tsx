import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import {
  getTaskAnalytics,
  type TaskAnalyticsPlatform,
  type TaskAnalyticsResult,
} from "@/platforms/task-analytics/service";

echarts.use([
  BarChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const EMPTY_RESULT: TaskAnalyticsResult = { days: [] };

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${month}/${day}`;
}

export function TaskStatisticsChart({ platform }: { platform: TaskAnalyticsPlatform }) {
  const chartElementRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<TaskAnalyticsResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const nextResult = await getTaskAnalytics(platform, 30);
        if (active) setResult(nextResult);
      } catch (error) {
        if (active) {
          setResult({
            days: [],
            unavailableReason: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const refreshInterval = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
    };
  }, [platform]);

  const hasData = useMemo(
    () => result.days.some((day) => day.succeeded || day.failed),
    [result.days],
  );

  useEffect(() => {
    const element = chartElementRef.current;
    if (!element || loading || result.unavailableReason || !hasData) return;

    const dark = document.documentElement.classList.contains("dark");
    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chart.setOption({
      animationDuration: 450,
      color: ["#2563eb", "#ef4444"],
      title: {
        text: "近30天上传统计",
        left: 0,
        top: 0,
        textStyle: {
          color: dark ? "#f4f4f5" : "#18181b",
          fontFamily: "Geist Variable, sans-serif",
          fontSize: 14,
          fontWeight: 600,
        },
      },
      legend: {
        top: 0,
        right: 0,
        itemHeight: 8,
        itemWidth: 12,
        textStyle: { color: dark ? "#a1a1aa" : "#71717a", fontSize: 11 },
      },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 4, right: 4, top: 42, bottom: 12, containLabel: true },
      xAxis: {
        type: "category",
        data: result.days.map((day) => shortDate(day.date)),
        axisLine: { lineStyle: { color: dark ? "#3f3f46" : "#e4e4e7" } },
        axisTick: { show: false },
        axisLabel: { color: dark ? "#a1a1aa" : "#71717a", fontSize: 10 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: dark ? "#a1a1aa" : "#71717a", fontSize: 10 },
        splitLine: { lineStyle: { color: dark ? "#27272a" : "#f1f1f3" } },
      },
      series: [
        {
          name: "成功任务",
          type: "bar",
          barMaxWidth: 13,
          data: result.days.map((day) => day.succeeded),
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "失败任务",
          type: "bar",
          barMaxWidth: 13,
          data: result.days.map((day) => day.failed),
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ],
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [hasData, loading, result]);

  const stateText = loading
    ? "正在加载任务统计…"
    : result.unavailableReason
      ? "统计数据暂不可用"
      : !hasData
        ? "近30天暂无任务统计数据"
        : null;

  return (
    <section
      aria-label="近30天任务统计图"
      className="absolute inset-x-6 top-[55%] bottom-10"
    >
      {stateText ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {stateText}
        </div>
      ) : (
        <div ref={chartElementRef} className="h-full w-full" role="img" />
      )}
    </section>
  );
}
