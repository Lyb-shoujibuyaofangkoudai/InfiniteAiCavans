import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type StyledEdgeData = { kind?: string; label?: string };
export type StyledEdgeType = Edge<StyledEdgeData, "styled">;

// 不同来源节点类型采用不同强调色；动画连线用于 image/video/audio 这类生成流。
const KIND_COLORS: Record<string, { stroke: string; animated: boolean }> = {
    text: { stroke: "#78716c", animated: false },
    image: { stroke: "#10b981", animated: true },
    video: { stroke: "#f97316", animated: true },
    audio: { stroke: "#a855f7", animated: true },
    config: { stroke: "#60a5fa", animated: false },
    group: { stroke: "#94a3b8", animated: false },
};

export function StyledEdge(props: EdgeProps<StyledEdgeType>) {
    const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
    const kind = data?.kind ?? "default";
    const cfg = KIND_COLORS[kind] ?? { stroke: theme.node.muted, animated: false };
    const stroke = selected ? theme.node.activeStroke : cfg.stroke;
    return (
        <>
            <BaseEdge
                id={id}
                path={path}
                style={{
                    stroke,
                    strokeWidth: selected ? 3 : 2,
                    opacity: selected ? 1 : 0.88,
                    strokeDasharray: cfg.animated ? "5 4" : undefined,
                    // 复用 xyflow 全局 @keyframes dashdraw（style.css 内已定义）
                    animation: cfg.animated ? "dashdraw 0.5s linear infinite" : undefined,
                }}
            />
            {data?.label ? (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: "absolute",
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                            padding: "2px 6px",
                            background: theme.toolbar.panel,
                            border: `1px solid ${theme.toolbar.border}`,
                            borderRadius: 6,
                            fontSize: 11,
                            color: theme.toolbar.item,
                            pointerEvents: "none",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {data.label}
                    </div>
                </EdgeLabelRenderer>
            ) : null}
        </>
    );
}
