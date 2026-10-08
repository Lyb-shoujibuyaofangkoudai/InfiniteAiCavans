import type { Node } from "@xyflow/react";

import { getNodeSpec } from "@/constant/canvas";
import type { CanvasNodeData, CanvasNodeTypeId, Position } from "@/types/canvas";

// xyflow 节点的 data 即原画布 CanvasNodeData。这里把 xyflow 的位置/尺寸合并回去：
// parentId 相对坐标换算成绝对坐标，并同步 parentId 到 metadata.groupId，
// 供直接复用的原画布组件（侧栏、小地图、选区工具栏等）消费，不改动原组件。
export function toCanvasNodes(nodes: Node<CanvasNodeData>[]): CanvasNodeData[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const cache = new Map<string, Position>();
    const absolute = (node: Node<CanvasNodeData>): Position => {
        const hit = cache.get(node.id);
        if (hit) return hit;
        const parent = node.parentId ? byId.get(node.parentId) : undefined;
        const position = parent ? { x: node.position.x + absolute(parent).x, y: node.position.y + absolute(parent).y } : { x: node.position.x, y: node.position.y };
        cache.set(node.id, position);
        return position;
    };
    return nodes.map((node) => ({
        ...node.data,
        position: absolute(node),
        width: node.measured?.width ?? node.width ?? node.data.width,
        height: node.measured?.height ?? node.height ?? node.data.height,
        metadata: { ...node.data.metadata, groupId: node.parentId },
    }));
}

// 新建节点的 CanvasNodeData：标题沿用原画布节点定义。
export function makeCanvasNodeData(id: string, type: CanvasNodeTypeId, position: Position, width: number, height: number, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    const spec = getNodeSpec(type);
    return { id, type, title: spec.title, position, width, height, metadata };
}
