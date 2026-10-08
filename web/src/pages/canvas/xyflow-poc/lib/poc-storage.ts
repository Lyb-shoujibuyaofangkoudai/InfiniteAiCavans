import localforage from "localforage";
import type { Edge, Node, Viewport } from "@xyflow/react";

import type { CanvasNodeData } from "@/types/canvas";

const POC_KEY = "infinite-canvas:xyflow_poc";

// 存储结构版本：节点 data 改为完整 CanvasNodeData 后升到 2，旧版本直接丢弃不做迁移。
const POC_STATE_VERSION = 2;

export type PocState = {
    version?: number;
    nodes: Node<CanvasNodeData>[];
    edges: Edge[];
    viewport: Viewport;
    title?: string;
};

export async function loadPocState(): Promise<PocState | null> {
    try {
        const raw = await localforage.getItem<string>(POC_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PocState>;
        if (parsed.version !== POC_STATE_VERSION || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
        return {
            nodes: parsed.nodes,
            edges: parsed.edges,
            viewport: parsed.viewport ?? { x: 0, y: 0, zoom: 1 },
            title: typeof parsed.title === "string" ? parsed.title : undefined,
        };
    } catch {
        return null;
    }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedState: PocState | null = null;

export function savePocState(state: PocState, delay = 400) {
    queuedState = { ...state, version: POC_STATE_VERSION };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const next = queuedState;
        if (!next) return;
        void localforage.setItem(POC_KEY, JSON.stringify(next)).catch(() => {});
    }, delay);
}

export function clearPocState() {
    queuedState = null;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    void localforage.removeItem(POC_KEY).catch(() => {});
}
