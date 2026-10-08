import { createContext, useContext, useMemo, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";

import { getNodeDefinition } from "@/lib/canvas/node-registry";
import type { CanvasNodeData } from "@/types/canvas";

import { PocCanvasNode } from "./poc-canvas-node";

// xyflow 节点：data 直接承载原画布同构的 CanvasNodeData，节点本体由 PoC 独立实现渲染。
export type PocFlowNode = Node<CanvasNodeData>;

// 节点宿主上下文：index.tsx 提供回调与全局状态，节点组件只做转发适配。
export type PocNodeHost = {
    showImageInfo: boolean;
    dialogNodeId: string | null;
    batchExpandedNodeId: string | null;
    groupDropTargetId: string | null;
    groupChildCounts: Record<string, number>;
    renderPanel: (node: CanvasNodeData) => ReactNode;
    onContentChange: (nodeId: string, content: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onNodeResize: (nodeId: string, width: number, height: number, position?: { x: number; y: number }) => void;
    onToggleBatch: (nodeId: string) => void;
    onSetBatchPrimary: (nodeId: string, itemId: string) => void;
    onDuplicateBatchImage: (node: CanvasNodeData, imageId: string) => void;
    onDownloadBatchImage: (node: CanvasNodeData, imageId?: string) => void;
    onDeleteBatchImage: (nodeId: string, imageId: string) => void;
    onViewImage: (node: CanvasNodeData, imageId?: string) => void;
};

const PocNodeHostContext = createContext<PocNodeHost | null>(null);

export function PocNodeHostProvider({ value, children }: { value: PocNodeHost; children: ReactNode }) {
    return <PocNodeHostContext.Provider value={value}>{children}</PocNodeHostContext.Provider>;
}

// 所有节点类型共用这一个 xyflow 自定义节点：渲染 PoC 独立实现 PocCanvasNode，
// 外层叠加不可见的 xyflow Handle 承接连线（节点内的连接点仅是视觉展示）。
export function ReactFlowCanvasNode({ id, data, selected, width, height, positionAbsoluteX, positionAbsoluteY }: NodeProps<PocFlowNode>) {
    const host = useContext(PocNodeHostContext);
    const scale = useStore((state) => state.transform[2]);
    const isConnecting = useStore((state) => state.connection.inProgress);
    // 相对父级的坐标：分组子节点的缩放换算不能用绝对坐标，从 xyflow 内部节点取 node.position。
    const internalNode = useStore((state) => state.nodeLookup.get(id));
    // 节点内部读取 data.position/width/height（图片渲染、缩放比例等），
    // 这里把 xyflow 的绝对坐标与尺寸合并进 data，保持与原画布数据语义一致。
    const canvasData = useMemo(
        () => ({
            ...data,
            position: { x: positionAbsoluteX, y: positionAbsoluteY },
            width: width ?? data.width,
            height: height ?? data.height,
        }),
        [data, width, height, positionAbsoluteX, positionAbsoluteY],
    );
    if (!host) return null;
    const definition = getNodeDefinition(data.type);
    const isGroup = data.type === "group";

    // 文本编辑等表单元素内拖拽不应移动节点：在捕获阶段拦截 pointerdown，
    // 避免 xyflow 的节点拖拽从 textarea/input 启动（Handle 不在拦截范围）。
    const handlePointerDownCapture = (event: ReactPointerEvent) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") event.stopPropagation();
    };

    return (
        <div className="h-full w-full" onPointerDownCapture={handlePointerDownCapture}>
            <PocCanvasNode
                data={canvasData}
                scale={scale}
                isSelected={Boolean(selected)}
                isConnecting={isConnecting}
                showPanel={host.dialogNodeId === id}
                showImageInfo={host.showImageInfo}
                batchExpanded={host.batchExpandedNodeId === id}
                isGroupDropTarget={host.groupDropTargetId === id}
                groupChildCount={isGroup ? host.groupChildCounts[id] ?? 0 : 0}
                resizeOrigin={internalNode?.position ?? { x: positionAbsoluteX, y: positionAbsoluteY }}
                renderPanel={host.renderPanel}
                onContentChange={host.onContentChange}
                onTitleChange={host.onTitleChange}
                onResize={host.onNodeResize}
                onToggleBatch={host.onToggleBatch}
                onSetBatchPrimary={host.onSetBatchPrimary}
                onDuplicateBatchImage={host.onDuplicateBatchImage}
                onDownloadBatchImage={host.onDownloadBatchImage}
                onDeleteBatchImage={host.onDeleteBatchImage}
                onViewImage={host.onViewImage}
            />
            {/* 不可见 xyflow 连接锚点：与节点连接点位置一致（左进右出），hover/选中时才响应指针。
                分组无锚点；config 只有 target；无 source 的扩展节点同样跳过。 */}
            {!isGroup ? <Handle type="target" position={Position.Left} className="poc-ghost-handle" /> : null}
            {!isGroup && (definition?.hasSourceHandle ?? true) && data.type !== "config" ? <Handle type="source" position={Position.Right} className="poc-ghost-handle" /> : null}
        </div>
    );
}
