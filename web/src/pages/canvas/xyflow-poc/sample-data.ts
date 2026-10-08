import type { Edge } from "@xyflow/react";

import type { CanvasNodeData } from "@/types/canvas";
import type { StyledEdgeData } from "./edges/styled-edge";
import type { PocFlowNode } from "./nodes/react-flow-node";

// 内置占位图：不依赖网络，验证节点渲染、缩放、连线即可。导出供新建图片节点复用。
export const placeholderImage =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#60a5fa"/></linearGradient></defs><rect width="240" height="180" rx="6" fill="url(#g)"/><text x="120" y="96" text-anchor="middle" fill="white" font-size="14" font-family="sans-serif">PoC Image</text></svg>',
    );

// 第二张占位图：演示多图节点的批量展示与主图切换。
export const placeholderImageAlt =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f0abfc"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs><rect width="240" height="180" rx="6" fill="url(#g)"/><text x="120" y="96" text-anchor="middle" fill="white" font-size="14" font-family="sans-serif">PoC Image 2</text></svg>',
    );

// 节点 data 直接承载原画布 CanvasNodeData；position/width/height 以 xyflow 节点为准。
const nodeData = (id: string, type: CanvasNodeData["type"], title: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id,
    type,
    title,
    position: { x: 0, y: 0 },
    width: 0,
    height: 0,
    metadata,
});

export const initialNodes: PocFlowNode[] = [
    { id: "g1", type: "group", position: { x: -420, y: 220 }, width: 660, height: 600, data: nodeData("g1", "group", "示例分组") },
    { id: "t1", type: "text", position: { x: -160, y: -220 }, width: 340, height: 240, data: nodeData("t1", "text", "文本", { content: "文本节点 · 双击进入编辑，Esc 退出" }) },
    { id: "t2", type: "text", position: { x: -160, y: 80 }, width: 340, height: 240, data: nodeData("t2", "text", "文本", { content: "背景拖动平移，滚轮缩放，框选多节点，右键呼出菜单" }) },
    { id: "i1", type: "image", position: { x: 260, y: -180 }, width: 340, height: 240, data: nodeData("i1", "image", "图片", { content: placeholderImage, naturalWidth: 240, naturalHeight: 180 }) },
    { id: "i2", type: "image", position: { x: 260, y: 160 }, width: 340, height: 240, data: nodeData("i2", "image", "图片", { content: placeholderImage, naturalWidth: 240, naturalHeight: 180, images: [
        { id: "i2-a", content: placeholderImage, naturalWidth: 240, naturalHeight: 180, status: "completed" },
        { id: "i2-b", content: placeholderImageAlt, naturalWidth: 240, naturalHeight: 180, status: "completed" },
    ] }) },
    // 分组子节点：video / audio。parentId 下 position 是相对 g1 的坐标（g1 在 -420,220）。
    { id: "v1", type: "video", position: { x: 40, y: 60 }, width: 420, height: 236, data: nodeData("v1", "video", "视频", {}), parentId: "g1" },
    { id: "a1", type: "audio", position: { x: 40, y: 340 }, width: 340, height: 120, data: nodeData("a1", "audio", "音频", {}), parentId: "g1" },
    { id: "c1", type: "config", position: { x: 720, y: 260 }, width: 340, height: 240, data: nodeData("c1", "config", "生成配置", { prompt: "一只戴宇航帽的柴犬，像素风" }) },
];

export const initialEdges: Edge<StyledEdgeData, "styled">[] = [
    // 连线样式按来源节点类型区分：text 灰、image 绿、video 橙动画、group 中性。
    { id: "e1", type: "styled", source: "t1", target: "i1", data: { kind: "text", label: "文本→图" } },
    { id: "e2", type: "styled", source: "t2", target: "i2", data: { kind: "text" } },
    { id: "e3", type: "styled", source: "g1", target: "c1", data: { kind: "group", label: "分组→配置" } },
    { id: "e4", type: "styled", source: "v1", target: "c1", data: { kind: "video", label: "视频→配置" } },
];
