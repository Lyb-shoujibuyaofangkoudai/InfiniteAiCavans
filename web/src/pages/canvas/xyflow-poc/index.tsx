import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
    Background,
    BackgroundVariant,
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    useEdgesState,
    useNodesState,
    useReactFlow,
    useViewport,
    type Connection,
    type Edge,
    type EdgeMouseHandler,
    type NodeMouseHandler,
    type OnNodeDrag,
    type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { App } from "antd";

import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { NodeCreateMenu } from "@/components/canvas/canvas-create-menus";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasSelectionToolbar } from "@/components/canvas/canvas-selection-toolbar";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { getNodeSpec } from "@/constant/canvas";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeTypeId, ContextMenuState } from "@/types/canvas";

import { makeCanvasNodeData, toCanvasNodes } from "./lib/canvas-adapter";
import { clearPocState, loadPocState, savePocState } from "./lib/poc-storage";
import { StyledEdge } from "./edges/styled-edge";
import { PocNodeHostProvider, ReactFlowCanvasNode, type PocFlowNode, type PocNodeHost } from "./nodes/react-flow-node";
import { initialEdges, initialNodes } from "./sample-data";

// 与原画布 project.tsx 一致：注册内置节点定义，供新建菜单、侧栏标题、小地图配色使用。
registerBuiltinNodes();

// 所有节点类型共用同一个 xyflow 自定义节点（内部渲染原 CanvasNode）。
const nodeTypes = { text: ReactFlowCanvasNode, image: ReactFlowCanvasNode, video: ReactFlowCanvasNode, audio: ReactFlowCanvasNode, config: ReactFlowCanvasNode, group: ReactFlowCanvasNode } as const;
const edgeTypes = { styled: StyledEdge } as const;

const EDGE_LABELS: Record<string, string> = {
    text: "文本",
    image: "图",
    video: "视频",
    audio: "音频",
    config: "配置",
    group: "分组",
};

type Snapshot = { nodes: PocFlowNode[]; edges: Edge[] };

// 撤销/重做的比较键：忽略 selected 标记，避免纯选中变化刷历史。
const snapshotKey = (snapshot: Snapshot) =>
    JSON.stringify({
        n: snapshot.nodes.map(({ selected: _selected, ...rest }) => rest),
        e: snapshot.edges.map(({ selected: _selected, ...rest }) => rest),
    });

export default function XyflowPocPage() {
    return (
        <ReactFlowProvider>
            <FlowCanvas />
        </ReactFlowProvider>
    );
}

function FlowCanvas() {
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const { screenToFlowPosition, setViewport, setCenter } = useReactFlow();
    const vp = useViewport();
    const navigate = useNavigate();
    const { modal, message } = App.useApp();

    const [title, setTitle] = useState("未命名画布");
    const [titleDraft, setTitleDraft] = useState("");
    const [titleEditing, setTitleEditing] = useState(false);
    const [bgMode, setBgMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [miniMapOpen, setMiniMapOpen] = useState(true);
    const [canvasTool, setCanvasTool] = useState<"select" | "pan">("select");
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const [hydrated, setHydrated] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<{ x: number; y: number } | null>(null);
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    // 节点宿主状态：面板节点、批量展开、分组拖放高亮、图片预览
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [batchExpandedNodeId, setBatchExpandedNodeId] = useState<string | null>(null);
    const [groupDropTargetId, setGroupDropTargetId] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const sectionRef = useRef<HTMLElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // 撤销/重做：防抖快照栈
    const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
    const lastSnapshotRef = useRef<Snapshot | null>(null);
    const lastKeyRef = useRef<string | null>(null);
    const applyingRef = useRef(false);
    const [historyVersion, setHistoryVersion] = useState(0);

    // 本地持久化：加载
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const saved = await loadPocState();
            if (cancelled) return;
            if (saved) {
                setNodes(saved.nodes);
                setEdges(saved.edges);
                if (saved.title) setTitle(saved.title);
                void setViewport(saved.viewport);
            }
            setHydrated(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [setEdges, setNodes, setViewport]);

    // 本地持久化：保存（节点/边/标题变化时防抖落盘，视口读取当前值）
    useEffect(() => {
        if (!hydrated) return;
        savePocState({ nodes, edges, viewport: vp, title });
    }, [hydrated, nodes, edges, title, vp]);

    // 视口变化时单独触发一次防抖保存（节点/边未变也要落盘平移缩放）
    const onMoveEnd = useCallback(
        (_: unknown, viewport: Viewport) => {
            if (!hydrated) return;
            savePocState({ nodes, edges, viewport, title });
        },
        [hydrated, nodes, edges, title],
    );

    // 画布区域尺寸：小地图、缩放居中、节点聚焦都需要
    useEffect(() => {
        const element = sectionRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // 撤销/重做快照：变化停止 400ms 后记入历史
    useEffect(() => {
        if (!hydrated) return;
        const timer = setTimeout(() => {
            const snapshot: Snapshot = { nodes, edges };
            const key = snapshotKey(snapshot);
            if (applyingRef.current) {
                applyingRef.current = false;
            } else if (lastKeyRef.current !== null && lastKeyRef.current !== key) {
                const last = lastSnapshotRef.current;
                if (last) {
                    historyRef.current.past.push(last);
                    historyRef.current.future = [];
                    setHistoryVersion((version) => version + 1);
                }
            }
            lastKeyRef.current = key;
            lastSnapshotRef.current = snapshot;
        }, 400);
        return () => clearTimeout(timer);
    }, [nodes, edges, hydrated]);

    const undo = useCallback(() => {
        const past = historyRef.current.past;
        if (!past.length) return;
        const previous = past.pop()!;
        historyRef.current.future.push({ nodes, edges });
        applyingRef.current = true;
        setNodes(previous.nodes);
        setEdges(previous.edges);
        setHistoryVersion((version) => version + 1);
    }, [edges, nodes, setEdges, setNodes]);

    const redo = useCallback(() => {
        const future = historyRef.current.future;
        if (!future.length) return;
        const next = future.pop()!;
        historyRef.current.past.push({ nodes, edges });
        applyingRef.current = true;
        setNodes(next.nodes);
        setEdges(next.edges);
        setHistoryVersion((version) => version + 1);
    }, [edges, nodes, setEdges, setNodes]);

    // 原画布组件消费的适配数据
    const canvasNodes = useMemo(() => toCanvasNodes(nodes), [nodes]);
    const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
    const selectedIds = useMemo(() => new Set(selectedNodes.map((node) => node.id)), [selectedNodes]);
    const selectedCanvasNodes = useMemo(() => canvasNodes.filter((node) => selectedIds.has(node.id)), [canvasNodes, selectedIds]);
    const canGroup = selectedNodes.length >= 2 && new Set(selectedNodes.map((node) => node.parentId).filter(Boolean)).size !== 1;
    const canUngroup = selectedNodes.some((node) => node.type === "group" && nodes.some((child) => child.parentId === node.id));
    const groupChildCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const node of nodes) {
            if (node.parentId) counts[node.parentId] = (counts[node.parentId] ?? 0) + 1;
        }
        return counts;
    }, [nodes]);

    const onConnect = useCallback(
        (connection: Connection) => {
            // 新连线按来源/目标节点类型设置 kind 与 label，与示例边一致
            const sourceNode = nodes.find((node) => node.id === connection.source);
            const targetNode = nodes.find((node) => node.id === connection.target);
            const sourceType = sourceNode?.type ?? "default";
            const targetType = targetNode?.type ?? "default";
            setEdges((eds) =>
                addEdge(
                    {
                        ...connection,
                        type: "styled",
                        data: { kind: sourceType, label: `${EDGE_LABELS[sourceType] ?? sourceType}→${EDGE_LABELS[targetType] ?? targetType}` },
                    },
                    eds,
                ),
            );
        },
        [nodes, setEdges],
    );

    // 画布中心（流坐标）：新建节点/插入素材的落点
    const flowCenter = useCallback(() => {
        const jitter = () => Math.random() * 80 - 40;
        return { x: (size.width / 2 - vp.x) / vp.zoom + jitter(), y: (size.height / 2 - vp.y) / vp.zoom + jitter() };
    }, [size, vp]);

    // 节点 data 变更的通用补丁
    const patchNodeData = useCallback(
        (nodeId: string, patch: (data: CanvasNodeData) => CanvasNodeData) => {
            setNodes((nds) => nds.map((node) => (node.id === nodeId ? { ...node, data: patch(node.data) } : node)));
        },
        [setNodes],
    );

    const patchNodeMetadata = useCallback(
        (nodeId: string, patch: Record<string, unknown>) => {
            patchNodeData(nodeId, (data) => ({ ...data, metadata: { ...data.metadata, ...patch } }));
        },
        [patchNodeData],
    );

    const addNode = useCallback(
        (type: string, position: { x: number; y: number }, metadata?: CanvasNodeData["metadata"]) => {
            // 新建节点默认尺寸沿用原画布 NODE_SPECS
            const spec = getNodeSpec(type);
            const id = `${type.slice(0, 1)}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
            const node: PocFlowNode = {
                id,
                type,
                position,
                width: spec.width,
                height: spec.height,
                selected: true,
                data: makeCanvasNodeData(id, type as CanvasNodeTypeId, position, spec.width, spec.height, metadata),
            };
            setNodes((nds) => [...nds.map((item) => ({ ...item, selected: false })), node]);
            // 与原画布一致：新建非 text/audio 节点后直接打开它的面板
            if (type !== "text" && type !== "audio" && type !== "group") setDialogNodeId(id);
        },
        [setNodes],
    );

    const createNode = useCallback((type: string) => addNode(type, flowCenter()), [addNode, flowCenter]);

    const insertAsset = useCallback(
        (payload: InsertAssetPayload) => {
            const position = flowCenter();
            if (payload.kind === "text") addNode("text", position, { content: payload.content || payload.title });
            else if (payload.kind === "image") addNode("image", position, { content: payload.dataUrl });
            else addNode("video", position, { content: payload.url });
        },
        [addNode, flowCenter],
    );

    const onUploadFile = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            addNode("image", flowCenter(), { content: URL.createObjectURL(file) });
        },
        [addNode, flowCenter],
    );

    // 双击画布空白处：换算成流坐标后打开原 NodeCreateMenu（在视口变换层内渲染，与原实现一致）
    const handleCanvasDoubleClick = useCallback(
        (event: ReactMouseEvent) => {
            const target = event.target as Element;
            if (target.closest(".react-flow__node,[data-canvas-no-zoom]")) return;
            setNodeCreatePosition(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        },
        [screenToFlowPosition],
    );

    const focusNode = useCallback(
        (nodeId: string) => {
            const target = canvasNodes.find((node) => node.id === nodeId);
            if (!target || !size.width) return;
            const zoom = Math.min(Math.max(Math.min((size.width * 0.6) / target.width, (size.height * 0.6) / target.height), 0.05), 1);
            setCenter(target.position.x + target.width / 2, target.position.y + target.height / 2, { zoom, duration: 300 });
            setNodes((nds) => nds.map((node) => ({ ...node, selected: node.id === nodeId })));
            setEdges((eds) => eds.map((edge) => ({ ...edge, selected: false })));
        },
        [canvasNodes, setCenter, setEdges, setNodes, size],
    );

    const duplicateNode = useCallback(
        (nodeId: string) => {
            setNodes((nds) => {
                const node = nds.find((item) => item.id === nodeId);
                if (!node) return nds;
                const id = `${node.id}-${Date.now()}`;
                return [
                    ...nds,
                    { ...node, id, selected: false, position: { x: node.position.x + 30, y: node.position.y + 30 }, data: { ...node.data, id, position: { x: node.position.x + 30, y: node.position.y + 30 } } },
                ];
            });
        },
        [setNodes],
    );

    const deleteNodeById = useCallback(
        (nodeId: string) => {
            setNodes((nds) => nds.filter((item) => item.id !== nodeId));
            setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
            setDialogNodeId((current) => (current === nodeId ? null : current));
        },
        [setEdges, setNodes],
    );

    const deleteSelection = useCallback(() => {
        if (!selectedIds.size) return;
        setNodes((nds) => nds.filter((node) => !selectedIds.has(node.id)));
        setEdges((eds) => eds.filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target)));
    }, [selectedIds, setEdges, setNodes]);

    const groupSelection = useCallback(() => {
        const selected = nodes.filter((node) => node.selected && node.type !== "group");
        if (selected.length < 2) return;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const node of selected) {
            const w = node.measured?.width ?? node.width ?? 0;
            const h = node.measured?.height ?? node.height ?? 0;
            left = Math.min(left, node.position.x);
            top = Math.min(top, node.position.y);
            right = Math.max(right, node.position.x + w);
            bottom = Math.max(bottom, node.position.y + h);
        }
        const pad = 24;
        const topPad = 52;
        const groupId = `g${Date.now()}`;
        const groupPosition = { x: left - pad, y: top - topPad };
        const groupWidth = right - left + pad * 2;
        const groupHeight = bottom - top + topPad + pad;
        const ids = new Set(selected.map((node) => node.id));
        setNodes((nds) => {
            const updated = nds.map((node) =>
                ids.has(node.id)
                    ? {
                          ...node,
                          parentId: groupId,
                          // 不设 extent:"parent"，避免子节点被限制在分组 bounds 内只能小范围移动；
                          // parentId 已让 xyflow 在渲染时按父级位置计算子节点绝对坐标，拖动分组时子节点会跟随。
                          position: { x: node.position.x - (left - pad), y: node.position.y - (top - topPad) },
                          selected: false,
                      }
                    : { ...node, selected: false },
            );
            // xyflow 要求父节点在 nodes 数组中位于子节点之前，否则 updateChildNode 找不到父级、
            // 子节点 positionAbsolute 不会随父级拖动重算。把新 group 放到数组最前。
            const group: PocFlowNode = {
                id: groupId,
                type: "group",
                position: groupPosition,
                width: groupWidth,
                height: groupHeight,
                selected: true,
                data: makeCanvasNodeData(groupId, "group", groupPosition, groupWidth, groupHeight),
            };
            return [group, ...updated];
        });
    }, [nodes, setNodes]);

    const ungroupSelection = useCallback(() => {
        const selectedGroups = nodes.filter((node) => node.selected && node.type === "group");
        if (!selectedGroups.length) return;
        const groupIds = new Set(selectedGroups.map((group) => group.id));
        setNodes((nds) =>
            nds
                .filter((node) => !groupIds.has(node.id))
                .map((node) => {
                    if (node.parentId && groupIds.has(node.parentId)) {
                        const parent = selectedGroups.find((group) => group.id === node.parentId);
                        if (parent) {
                            return { ...node, parentId: undefined, extent: undefined, position: { x: node.position.x + parent.position.x, y: node.position.y + parent.position.y } };
                        }
                    }
                    return node;
                }),
        );
    }, [nodes, setNodes]);

    // 节点拖拽吸附到 group：拖动时高亮目标分组，松手时落位成 parentId 子节点。
    const findDropTarget = useCallback(
        (node: PocFlowNode) => {
            // 只处理自由节点拖入分组；已在分组内的子节点拖动时不做命中（坐标是相对父级的）。
            if (node.type === "group" || node.parentId) return null;
            const groups = nodes.filter((item) => item.type === "group" && item.id !== node.id);
            const cx = node.position.x + (node.measured?.width ?? node.width ?? 0) / 2;
            const cy = node.position.y + (node.measured?.height ?? node.height ?? 0) / 2;
            for (let index = groups.length - 1; index >= 0; index -= 1) {
                const group = groups[index];
                const gw = group.measured?.width ?? group.width ?? 0;
                const gh = group.measured?.height ?? group.height ?? 0;
                if (cx >= group.position.x && cx <= group.position.x + gw && cy >= group.position.y && cy <= group.position.y + gh) return group;
            }
            return null;
        },
        [nodes],
    );

    const onNodeDrag: OnNodeDrag = useCallback(
        (_event, node) => {
            setGroupDropTargetId(findDropTarget(node as PocFlowNode)?.id ?? null);
        },
        [findDropTarget],
    );

    const onNodeDragStop: OnNodeDrag = useCallback(
        (_event, dragged) => {
            setIsNodeDragging(false);
            setGroupDropTargetId(null);
            const node = dragged as PocFlowNode;
            if (node.type === "group" || node.parentId) return;
            const target = findDropTarget(node);
            if (!target) return;
            setNodes((nds) =>
                nds.map((item) => (item.id === node.id ? { ...item, parentId: target.id, position: { x: item.position.x - target.position.x, y: item.position.y - target.position.y } } : item)),
            );
        },
        [findDropTarget, setNodes],
    );

    const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
        event.preventDefault();
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: node.id });
    }, []);

    const onEdgeContextMenu: EdgeMouseHandler = useCallback((event, edge) => {
        event.preventDefault();
        setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: edge.id });
    }, []);

    // 与原画布一致：点击节点打开其面板，点击画布空白关闭
    const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
        setDialogNodeId(node.type === "group" ? null : node.id);
    }, []);

    const onPaneClick = useCallback(() => setDialogNodeId(null), []);

    // ---- 节点宿主回调：全部写回 xyflow 节点 data ----
    const handleContentChange = useCallback(
        (nodeId: string, content: string) => {
            patchNodeMetadata(nodeId, { content });
        },
        [patchNodeMetadata],
    );

    const handleTitleChange = useCallback(
        (nodeId: string, nextTitle: string) => {
            patchNodeData(nodeId, (data) => ({ ...data, title: nextTitle }));
        },
        [patchNodeData],
    );

    const handleNodeResize = useCallback(
        (nodeId: string, width: number, height: number, position?: { x: number; y: number }) => {
            setNodes((nds) =>
                nds.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              width,
                              height,
                              position: position ?? node.position,
                              // 同步进 data，保持 CanvasNode 内部读取（缩放比例等）与 xyflow 一致
                              data: { ...node.data, width, height, position: position ?? node.data.position },
                          }
                        : node,
                ),
            );
        },
        [setNodes],
    );

    const handleToggleBatch = useCallback((nodeId: string) => {
        setBatchExpandedNodeId((current) => (current === nodeId ? null : nodeId));
    }, []);

    const handleSetBatchPrimary = useCallback(
        (nodeId: string, itemId: string) => {
            patchNodeData(nodeId, (data) => {
                const image = (data.metadata?.images ?? []).find((item) => item.id === itemId);
                const text = (data.metadata?.texts ?? []).find((item) => item.id === itemId);
                return {
                    ...data,
                    metadata: {
                        ...data.metadata,
                        primaryImageId: image ? itemId : data.metadata?.primaryImageId,
                        primaryTextId: text ? itemId : data.metadata?.primaryTextId,
                        content: image?.content ?? text?.content ?? data.metadata?.content,
                        storageKey: image?.storageKey ?? data.metadata?.storageKey,
                        naturalWidth: image?.naturalWidth ?? data.metadata?.naturalWidth,
                        naturalHeight: image?.naturalHeight ?? data.metadata?.naturalHeight,
                    },
                };
            });
        },
        [patchNodeData],
    );

    const handleDuplicateBatchImage = useCallback(
        (node: CanvasNodeData, imageId: string) => {
            const image = (node.metadata?.images ?? []).find((item) => item.id === imageId);
            if (!image) return;
            addNode("image", { x: node.position.x + 40, y: node.position.y + 40 }, { content: image.content ?? "", naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
        },
        [addNode],
    );

    const downloadUrl = useCallback((url: string, filename: string) => {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
    }, []);

    const handleDownloadBatchImage = useCallback(
        (node: CanvasNodeData, imageId?: string) => {
            const images = node.metadata?.images ?? [];
            const image = images.find((item) => item.id === imageId) ?? images.find((item) => item.id === node.metadata?.primaryImageId) ?? images[0];
            const url = image?.content ?? node.metadata?.content;
            if (!url) return;
            downloadUrl(url, `${node.title || "image"}.png`);
        },
        [downloadUrl],
    );

    const handleDeleteBatchImage = useCallback(
        (nodeId: string, imageId: string) => {
            patchNodeData(nodeId, (data) => {
                const images = (data.metadata?.images ?? []).filter((item) => item.id !== imageId);
                const wasPrimary = data.metadata?.primaryImageId === imageId || (!data.metadata?.primaryImageId && images[0]?.id === imageId);
                return {
                    ...data,
                    metadata: {
                        ...data.metadata,
                        images,
                        primaryImageId: wasPrimary ? images[0]?.id : data.metadata?.primaryImageId,
                        content: wasPrimary ? images[0]?.content : data.metadata?.content,
                        storageKey: wasPrimary ? images[0]?.storageKey : data.metadata?.storageKey,
                    },
                };
            });
        },
        [patchNodeData],
    );

    const handleViewImage = useCallback(
        (node: CanvasNodeData, imageId?: string) => {
            const images = node.metadata?.images ?? [];
            const image = images.find((item) => item.id === imageId) ?? images.find((item) => item.id === node.metadata?.primaryImageId) ?? images[0];
            const url = image?.content ?? node.metadata?.content;
            if (url) setLightbox({ url, title: node.title });
        },
        [],
    );

    // 配置/文本等节点的面板：复用原 CanvasNodePromptPanel，生成类动作为占位提示
    const connectedNodesByNodeId = useMemo(() => {
        const map: Record<string, CanvasNodeData[]> = {};
        const byId = new Map(canvasNodes.map((node) => [node.id, node]));
        for (const edge of edges) {
            const source = byId.get(edge.source);
            if (source && byId.has(edge.target)) (map[edge.target] ??= []).push(source);
        }
        return map;
    }, [canvasNodes, edges]);

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) => (
            // 面板是服务于正文的提示词入口：输入保存为 prompt/composerContent，由生成流程改写正文后回显；
            // PoC 未接入生成，面板输入只做持久化，不直接改动 TextContent。
            <CanvasNodePromptPanel
                node={panelNode}
                nodes={canvasNodes}
                isRunning={false}
                connectedNodes={connectedNodesByNodeId[panelNode.id] ?? []}
                onPromptChange={(nodeId, prompt) => patchNodeMetadata(nodeId, { prompt })}
                onConfigChange={(nodeId, patch) => patchNodeMetadata(nodeId, patch)}
                onGenerate={() => void message.info("PoC 阶段未接入生成")}
                onStop={() => {}}
                onDisconnectReference={(fromNodeId, toNodeId) =>
                    setEdges((eds) => eds.filter((edge) => !(edge.source === fromNodeId && edge.target === toNodeId) && !(edge.source === toNodeId && edge.target === fromNodeId)))
                }
                onStartReferenceSelection={() => {}}
            />
        ),
        [canvasNodes, connectedNodesByNodeId, message, patchNodeMetadata, setEdges],
    );

    const nodeHost = useMemo<PocNodeHost>(
        () => ({
            showImageInfo,
            dialogNodeId,
            batchExpandedNodeId,
            groupDropTargetId,
            groupChildCounts,
            renderPanel: renderNodePanel,
            onContentChange: handleContentChange,
            onTitleChange: handleTitleChange,
            onNodeResize: handleNodeResize,
            onToggleBatch: handleToggleBatch,
            onSetBatchPrimary: handleSetBatchPrimary,
            onDuplicateBatchImage: handleDuplicateBatchImage,
            onDownloadBatchImage: handleDownloadBatchImage,
            onDeleteBatchImage: handleDeleteBatchImage,
            onViewImage: handleViewImage,
        }),
        [
            showImageInfo,
            dialogNodeId,
            batchExpandedNodeId,
            groupDropTargetId,
            groupChildCounts,
            renderNodePanel,
            handleContentChange,
            handleTitleChange,
            handleNodeResize,
            handleToggleBatch,
            handleSetBatchPrimary,
            handleDuplicateBatchImage,
            handleDownloadBatchImage,
            handleDeleteBatchImage,
            handleViewImage,
        ],
    );

    // 视口工具：缩放滑杆按画布中心缩放，重置回到 100% 居中，与原画布公式一致
    const setZoomScale = useCallback(
        (scale: number) => {
            const nextZoom = Math.min(Math.max(scale, 0.05), 5);
            setViewport({
                x: size.width / 2 - ((size.width / 2 - vp.x) / vp.zoom) * nextZoom,
                y: size.height / 2 - ((size.height / 2 - vp.y) / vp.zoom) * nextZoom,
                zoom: nextZoom,
            });
        },
        [size, vp, setViewport],
    );

    const resetViewport = useCallback(() => {
        if (!size.width) return;
        setViewport({ x: size.width / 2, y: size.height / 2, zoom: 1 });
    }, [size, setViewport]);

    const resetCanvas = useCallback(() => {
        setNodes([]);
        setEdges([]);
        setTitle("未命名画布");
    }, [setEdges, setNodes]);

    const clearCanvas = useCallback(() => {
        modal.confirm({
            title: "清空画布",
            content: "确定清空当前画布的全部节点和连线吗？",
            okText: "清空",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                setNodes([]);
                setEdges([]);
            },
        });
    }, [modal, setEdges, setNodes]);

    const deleteCurrentCanvas = useCallback(() => {
        modal.confirm({
            title: "删除当前画布",
            content: "PoC 数据仅保存在浏览器本地，删除后不可恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                void clearPocState();
                resetCanvas();
            },
        });
    }, [modal, resetCanvas]);

    const exportCanvas = useCallback(() => {
        const blob = new Blob([JSON.stringify({ title, nodes, edges }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${title || "canvas"}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        void message.success("已导出画布数据");
    }, [edges, message, nodes, title]);

    const startTitleEditing = useCallback(() => {
        setTitleDraft(title);
        setTitleEditing(true);
    }, [title]);

    const finishTitleEditing = useCallback(() => {
        setTitle(titleDraft.trim() || title);
        setTitleEditing(false);
    }, [title, titleDraft]);

    const variant = bgMode === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines;

    return (
        <PocNodeHostProvider value={nodeHost}>
            <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
                <style>{`
                    .react-flow__attribution { display: none; }
                    .react-flow__background { opacity: 0.4; }
                    .react-flow__edge.selected .react-flow__edge-path { stroke: ${theme.node.activeStroke} !important; stroke-width: 3px; }
                    .react-flow__connection-path { stroke: ${theme.node.activeStroke}; stroke-width: 2px; }
                    .react-flow__selection { background: ${theme.canvas.selectionFill}; border: 1.5px dashed color-mix(in srgb, ${theme.canvas.selectionStroke} 55%, transparent); border-radius: 2px; }
                    .react-flow__handle.poc-ghost-handle { opacity: 0; width: 16px; height: 16px; min-width: 0; min-height: 0; border: none; background: transparent; pointer-events: none; }
                    .react-flow__node:hover .react-flow__handle.poc-ghost-handle, .react-flow__node.selected .react-flow__handle.poc-ghost-handle { pointer-events: all; }
                `}</style>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onUploadFile} />

                {/* 布局层级与原画布 project.tsx 保持一致：左侧面板 + 画布 section，顶栏/底部 dock/小地图悬浮在 section 内 */}
                <CanvasSidePanel nodes={canvasNodes} selectedNodeIds={selectedIds} onFocusNode={focusNode} onPreviewNode={focusNode} onInsertAsset={insertAsset} />
                <section ref={sectionRef} className="relative min-w-0 flex-1 overflow-hidden">
                    <CanvasTopBar
                        title={title}
                        titleDraft={titleDraft}
                        isTitleEditing={titleEditing}
                        onTitleDraftChange={setTitleDraft}
                        onStartTitleEditing={startTitleEditing}
                        onFinishTitleEditing={finishTitleEditing}
                        onCancelTitleEditing={() => setTitleEditing(false)}
                        canUndo={historyRef.current.past.length > 0}
                        canRedo={historyRef.current.future.length > 0}
                        onHome={() => navigate("/")}
                        onProjects={() => navigate("/canvas")}
                        onCreateProject={resetCanvas}
                        onDeleteProject={deleteCurrentCanvas}
                        onExportProject={exportCanvas}
                        onImportImage={() => fileInputRef.current?.click()}
                        onOpenPlugins={() => void message.info("PoC 阶段未接入插件管理")}
                        onUndo={undo}
                        onRedo={redo}
                        agentOpen={false}
                        compactAgentStatus={{ connected: false, enabled: false, activity: "" }}
                        onToggleAgent={() => void message.info("PoC 阶段未接入 Agent")}
                    />

                    {/* 双击空白呼出新建菜单：只监听画布区域，顶栏/底部 dock 的双击不受影响 */}
                    <div className="absolute inset-0" onDoubleClick={handleCanvasDoubleClick}>
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onConnect={onConnect}
                            onMoveEnd={onMoveEnd}
                            onNodeContextMenu={onNodeContextMenu}
                            onEdgeContextMenu={onEdgeContextMenu}
                            onNodeClick={onNodeClick}
                            onPaneClick={onPaneClick}
                            onNodeDrag={onNodeDrag}
                            onNodeDragStart={() => setIsNodeDragging(true)}
                            onNodeDragStop={onNodeDragStop}
                            nodeTypes={nodeTypes}
                            edgeTypes={edgeTypes}
                            deleteKeyCode={["Delete", "Backspace"]}
                            minZoom={0.05}
                            maxZoom={5}
                            selectionOnDrag={canvasTool === "select"}
                            panOnDrag={canvasTool === "pan" ? true : [1]}
                            zoomOnDoubleClick={false}
                            fitView
                            fitViewOptions={{ padding: 0.2 }}
                            proOptions={{ hideAttribution: true }}
                        >
                            {bgMode !== "blank" ? <Background variant={variant} gap={48} size={1.15} lineWidth={1} color={bgMode === "dots" ? theme.canvas.dot : theme.canvas.line} /> : null}
                        </ReactFlow>
                    </div>

                    {selectedCanvasNodes.length >= 2 ? (
                        <CanvasSelectionToolbar
                            nodes={selectedCanvasNodes}
                            viewport={{ x: vp.x, y: vp.y, k: vp.zoom }}
                            showToolbar={!isNodeDragging}
                            canGroup={canGroup}
                            canUngroup={canUngroup}
                            onGroup={groupSelection}
                            onUngroup={ungroupSelection}
                        />
                    ) : null}

                    <CanvasToolbar
                        selectedCount={selectedNodes.length}
                        canvasTool={canvasTool}
                        canUndo={historyRef.current.past.length > 0}
                        canRedo={historyRef.current.future.length > 0}
                        backgroundMode={bgMode}
                        showImageInfo={showImageInfo}
                        onAddImage={() => createNode("image")}
                        onAddVideo={() => createNode("video")}
                        onAddAudio={() => createNode("audio")}
                        onAddText={() => createNode("text")}
                        onAddConfig={() => createNode("config")}
                        onAddGroup={() => createNode("group")}
                        onAddExtensionNode={(type) => createNode(type)}
                        onUndo={undo}
                        onRedo={redo}
                        onUpload={() => fileInputRef.current?.click()}
                        onDelete={deleteSelection}
                        onClear={clearCanvas}
                        onCanvasToolChange={setCanvasTool}
                        onBackgroundModeChange={setBgMode}
                        onShowImageInfoChange={setShowImageInfo}
                    />

                    {miniMapOpen && size.width ? <Minimap nodes={canvasNodes} viewport={{ x: vp.x, y: vp.y, k: vp.zoom }} viewportSize={size} onViewportChange={(viewport) => setViewport({ x: viewport.x, y: viewport.y, zoom: viewport.k })} /> : null}

                    <CanvasZoomControls scale={vp.zoom} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={miniMapOpen} onToggleMiniMap={() => setMiniMapOpen((open) => !open)} />

                    {contextMenu ? (
                        <CanvasNodeContextMenu
                            menu={contextMenu}
                            canCaptureVideoFrame={false}
                            canGroup={contextMenu.type === "node" ? canGroup : undefined}
                            canUngroup={contextMenu.type === "node" ? canUngroup : undefined}
                            onClose={() => setContextMenu(null)}
                            onCaptureVideoFrame={() => {}}
                            onDuplicate={() => {
                                if (contextMenu.type !== "node") return;
                                duplicateNode(contextMenu.nodeId);
                                setContextMenu(null);
                            }}
                            onGroup={() => {
                                groupSelection();
                                setContextMenu(null);
                            }}
                            onUngroup={() => {
                                ungroupSelection();
                                setContextMenu(null);
                            }}
                            onDelete={() => {
                                if (contextMenu.type === "node") deleteNodeById(contextMenu.nodeId);
                                else if (contextMenu.type === "connection") setEdges((eds) => eds.filter((edge) => edge.id !== contextMenu.connectionId));
                                setContextMenu(null);
                            }}
                        />
                    ) : null}

                    {/* 新建菜单放在视口变换层内渲染，位置语义与原 InfiniteCanvas 的 children 容器一致 */}
                    {nodeCreatePosition ? (
                        <div className="absolute left-0 top-0 z-[120] h-0 w-0 origin-top-left" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` }}>
                            <NodeCreateMenu
                                position={nodeCreatePosition}
                                onCreate={(type) => {
                                    addNode(type, nodeCreatePosition);
                                    setNodeCreatePosition(null);
                                }}
                                onClose={() => setNodeCreatePosition(null)}
                            />
                        </div>
                    ) : null}
                </section>

                {/* 图片查看：点击图片节点或批量卡片时放大预览 */}
                {lightbox ? (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80" onClick={() => setLightbox(null)}>
                        <img src={lightbox.url} alt={lightbox.title} className="max-h-[85vh] max-w-[85vw] rounded-xl shadow-2xl" draggable={false} />
                    </div>
                ) : null}
            </main>
        </PocNodeHostProvider>
    );
}
