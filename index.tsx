/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, h } from "preact";
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { html } from "htm/preact";
import { GoogleGenAI } from "@google/genai";

// --- HELPERS ---
const generateId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const detectCycle = (nodes, edges) => {
    if (!nodes || nodes.length === 0) return false;

    const adj: Map<string, string[]> = new Map(nodes.map(n => [n.id, []]));
    const inDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));

    for (const edge of edges) {
        if (adj.has(edge.source) && inDegree.has(edge.target)) {
            adj.get(edge.source)!.push(edge.target);
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        }
    }

    const queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    let count = 0;

    while (queue.length > 0) {
        const u = queue.shift();
        count++;

        for (const v of (adj.get(u) || [])) {
            inDegree.set(v, inDegree.get(v)! - 1);
            if (inDegree.get(v) === 0) {
                queue.push(v);
            }
        }
    }
    return count !== nodes.length;
};

const UNIVERSAL_NODE_PROMPT = `You are a single, focused processing unit in a larger AI system. Your task is to perform a specific, small step in a thought process.

**Overall User Goal:**
{{user_prompt}}

**Your Input:**
{{input}}

**Your Instructions:**
- **If 'Your Input' is EMPTY:** You are the FIRST step. Provide a concise, foundational piece of information or a starting point to address the user's goal. Do NOT attempt to answer the whole query. Your output should be a single idea, fact, or concept.
- **If 'Your Input' is NOT EMPTY:** You are a subsequent step. Your only job is to build directly upon the text provided in 'Your Input'. You can expand, critique, simplify, or rephrase it. Do not introduce completely new topics. Your output must be a logical continuation of the input.

Generate only the text for your step. Be brief.`;

const generateArchitectureNotes = (nodes, edges) => {
    if (!nodes || nodes.length === 0) {
        return "This configuration is empty. Add nodes to begin building an AI.";
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const inDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));
    const outDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));

    for (const edge of edges) {
        if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
            outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        }
    }

    const rootNodeCount = nodes.filter(n => inDegree.get(n.id) === 0).length;
    const leafNodeCount = nodes.filter(n => outDegree.get(n.id) === 0).length;
    const isolatedNodeCount = nodes.filter(n => inDegree.get(n.id) === 0 && outDegree.get(n.id) === 0).length;
    const hasCycle = detectCycle(nodes, edges);

    let description = `Architecture Report:\n\n`;
    description += `- Nodes: ${nodes.length}\n`;
    description += `- Connections: ${edges.length}\n`;
    description += `- Entry Points (Root Nodes): ${rootNodeCount}\n`;
    description += `- Final Outputs (Leaf Nodes): ${leafNodeCount}\n`;

    if (hasCycle) {
        description += `\n\nError: A cycle is detected in the graph. The AI cannot process this configuration. Please find and remove the connection that forms the loop.`;
        return description;
    }

    if (isolatedNodeCount > 0) {
        description += `\n\nWarning: ${isolatedNodeCount} node(s) are completely isolated. They will act as both entry points and final outputs, which may lead to fragmented results.\n`;
    }

    const componentNodes = nodes.filter(n => n.type === 'component');
    if (componentNodes.length > 0) {
        description += `\nNote: This graph contains ${componentNodes.length} nested component(s). Their internal structure is not analyzed here.\n`;
    }

    if (nodes.length > 0 && edges.length === 0 && nodes.length > 1) {
        description += `\nObservation: All nodes are disconnected. The final output will be a collection of independent thoughts. To create a coherent process, connect the nodes.`;
    } else if (rootNodeCount > 1) {
        description += `\nObservation: Multiple entry points exist. The AI will start multiple independent thought processes. This can be useful for parallel analysis but may result in a disjointed final answer unless merged.`;
    } else if (leafNodeCount > 1) {
         description += `\nObservation: Multiple final outputs. The AI's response will be a combination of the results from ${leafNodeCount} different endpoints.`;
    } else if (nodes.length > 0 && rootNodeCount === 1 && leafNodeCount === 1) {
        description += `\nObservation: This is a single-flow architecture (one entry, one exit). It should produce a focused, sequential thought process.`;
    }

    return description;
};

const generateMermaid = (nodes, edges) => {
    if (!nodes || nodes.length === 0) return "graph TD;\n  Empty";
    
    // Map internal IDs to readable aliases
    const idMap = new Map();
    nodes.forEach((n, i) => idMap.set(n.id, `N${i+1}`));
    
    let chart = "graph TD;\n";
    
    // Nodes
    nodes.forEach((n, i) => {
        const label = n.type === 'component' ? `📦 ${n.label || 'Component'}` : `Node ${i+1}`;
        chart += `  ${idMap.get(n.id)}[${label}]\n`;
    });
    
    // Edges
    if (edges && edges.length > 0) {
        chart += "\n";
        edges.forEach(e => {
            if (idMap.has(e.source) && idMap.has(e.target)) {
                chart += `  ${idMap.get(e.source)} --> ${idMap.get(e.target)}\n`;
            }
        });
    }
    
    return chart;
}

// --- EXECUTION ENGINE ---

const runGraphEngine = async (nodes, edges, userPrompt, contextInput = "", ai, componentRegistry) => {
    if (!nodes || nodes.length === 0) return "";

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adj: Map<string, string[]> = new Map(nodes.map(n => [n.id, []]));
    const inDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));
    const outDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));

    for (const edge of edges) {
        if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
            adj.get(edge.source).push(edge.target);
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
            outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
        }
    }

    // Topological Sort
    const queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    const sortedNodes = [];
    
    while (queue.length > 0) {
        const nodeId = queue.shift();
        sortedNodes.push(nodeId);
        const neighbors = adj.get(nodeId) || [];
        for (const neighborId of neighbors) {
            inDegree.set(neighborId, inDegree.get(neighborId) - 1);
            if (inDegree.get(neighborId) === 0) {
                queue.push(neighborId);
            }
        }
    }

    if (sortedNodes.length !== nodes.length) {
        throw new Error("Graph has a cycle and cannot be processed.");
    }

    const nodeOutputs = new Map();
    
    for (const nodeId of sortedNodes) {
        // Gather inputs from parent nodes
        const parentEdges = edges.filter(e => e.target === nodeId);
        const parentNodeIds = parentEdges.map(e => e.source);
        
        let nodeInput = "";
        
        if (parentNodeIds.length === 0) {
            // Root node: uses the context input passed to this engine instance
            // If top level, this is empty. If subgraph, this is input from outer node.
            nodeInput = contextInput; 
        } else {
            // Internal node: joins outputs of parents
            const parentOutputs = parentNodeIds.map(pid => nodeOutputs.get(pid) || '');
            nodeInput = parentOutputs.join('\n\n---\n\n');
        }

        const node = nodeMap.get(nodeId) as any;
        let currentOutput = '';

        if (node.type === 'component') {
            // Recursive Execution
            const compDef = componentRegistry.find(c => c.id === node.componentId);
            if (compDef) {
                 // The component receives the accumulated 'nodeInput' as its starting context
                 // The 'userPrompt' (Goal) is passed down unchanged
                 currentOutput = await runGraphEngine(
                     compDef.nodes, 
                     compDef.edges, 
                     userPrompt, 
                     nodeInput, 
                     ai, 
                     componentRegistry
                 );
            } else {
                currentOutput = `[Error: Component '${node.label}' not found]`;
            }
        } else {
            // Standard Node Execution
            let filledPrompt = UNIVERSAL_NODE_PROMPT
                .replace(/{{user_prompt}}/g, userPrompt)
                .replace(/{{input}}/g, nodeInput);
            
            if (filledPrompt.trim()) {
                const result = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: filledPrompt,
                });
                currentOutput = result.text;
            }
        }
        
        nodeOutputs.set(nodeId, currentOutput);
    }

    // Collect outputs from leaf nodes of this graph level
    const leafNodeIds = nodes.filter(n => outDegree.get(n.id) === 0).map(n => n.id);
    const finalOutputs = leafNodeIds.map(id => nodeOutputs.get(id) || '');
    
    return finalOutputs.join('\n\n---\n\n').trim() || "No output.";
};


// --- PRESETS ---
const PRESETS = [
    {
        name: "Linear Chain (3 steps)",
        nodes: [
            { id: 'p1', position: { x: 0, y: 0 } },
            { id: 'p2', position: { x: 200, y: 0 } },
            { id: 'p3', position: { x: 400, y: 0 } },
        ],
        edges: [
            { source: 'p1', target: 'p2' },
            { source: 'p2', target: 'p3' },
        ]
    },
    {
        name: "Debate (Split & Merge)",
        nodes: [
            { id: 'root', position: { x: 0, y: 100 } },
            { id: 'branch1', position: { x: 200, y: 0 } },
            { id: 'branch2', position: { x: 200, y: 200 } },
            { id: 'synthesis', position: { x: 400, y: 100 } },
        ],
        edges: [
            { source: 'root', target: 'branch1' },
            { source: 'root', target: 'branch2' },
            { source: 'branch1', target: 'synthesis' },
            { source: 'branch2', target: 'synthesis' },
        ]
    },
];


// --- INITIAL DATA ---
const createDefaultNodes = () => ([
  {
    id: generateId('node'),
    position: { x: 150, y: 100 },
  },
  {
    id: generateId('node'),
    position: { x: 150, y: 250 },
  },
]);

const createDefaultEdges = () => ([]);

const defaultNodes = createDefaultNodes();
const defaultEdges = createDefaultEdges();

const INITIAL_CONFIGURATIONS = [
  {
    id: generateId('config'),
    name: "Disconnected Bot",
    nodes: defaultNodes,
    edges: defaultEdges,
    notes: generateArchitectureNotes(defaultNodes, defaultEdges)
  },
];

const QUIZZES = [
    {
        name: "Simple Concepts",
        questions: [
            "Explain the concept of black holes in simple terms.",
            "What is photosynthesis?",
            "Describe the water cycle briefly.",
        ]
    },
    {
        name: "Creative Writing",
        questions: [
            "Write a short opening line for a fantasy novel.",
            "Describe a futuristic city in one sentence.",
            "Create a single line of dialogue for a wise old robot.",
        ]
    }
];

const AI_MODEL_NAME = "gemini-2.5-flash";
let ai;

try {
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} catch (error) {
  console.error("Failed to initialize GoogleGenAI:", error);
}


// --- EDITOR COMPONENTS ---

const Node = ({ data, onMouseDown, onCopy, onDelete, onSocketMouseDown, onSocketMouseUp }) => {
  const { id, position, type, label } = data;
  
  // Safety check
  if (!position) return null;

  const handleAction = (e, action) => {
    e.preventDefault(); 
    e.stopPropagation();
    action(id);
  }

  const stopProp = (e) => e.stopPropagation();

  const isComponent = type === 'component';

  return html`
    <div
      class="node ${isComponent ? 'component-node' : ''}"
      style=${{ top: `${position.y}px`, left: `${position.x}px` }}
      onMouseDown=${(e) => onMouseDown(e, id)}
    >
      ${isComponent && html`<div class="node-label">${label}</div>`}
      <div 
        class="node-actions" 
        onMouseDown=${stopProp} 
        onClick=${stopProp}
      >
          <button class="node-action-btn" title="Copy" onMouseDown=${stopProp} onClick=${(e) => handleAction(e, onCopy)}>📄</button>
          <button class="node-action-btn" title="Delete" onMouseDown=${stopProp} onClick=${(e) => handleAction(e, onDelete)}>🗑️</button>
      </div>
      <div class="socket output" onMouseDown=${(e) => { e.stopPropagation(); onSocketMouseDown(e, id, 'output'); }}></div>
      <div class="socket input" onMouseUp=${(e) => { /* Removed stopPropagation here per previous fix */ onSocketMouseUp(e, id, 'input'); }}></div>
    </div>
  `;
};

const Edge = ({ edge, nodes, onClick }) => {
  const sourceNode = nodes.find((n) => n.id === edge.source);
  const targetNode = nodes.find((n) => n.id === edge.target);

  // Added safety checks with optional chaining
  if (!sourceNode?.position || !targetNode?.position) return null;

  const nodeRadius = 30;
  const x1 = sourceNode.position.x + (nodeRadius * 2); // right edge of source
  const y1 = sourceNode.position.y + nodeRadius; // vertical center
  const x2 = targetNode.position.x; // left edge of target
  const y2 = targetNode.position.y + nodeRadius; // vertical center

  const pathData = `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;

  return html`
    <g class="edge-group" onClick=${() => onClick(edge.id)}>
      <path class="edge-interaction-area" d=${pathData} />
      <path class="edge-path" d=${pathData} />
    </g>
  `;
};

const TextViewModal = ({ content, onClose }) => {
    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal-content" onClick=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <h2>Graph Text Notation (Mermaid)</h2>
                    <button class="modal-close-btn" onClick=${onClose}>&times;</button>
                </div>
                <div class="code-viewer">${content}</div>
            </div>
        </div>
    `;
};

const SaveComponentModal = ({ onClose, onSave }) => {
    const [name, setName] = useState('');
    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal-content" onClick=${(e) => e.stopPropagation()} style="max-width: 400px;">
                <div class="modal-header">
                    <h2>Save as Component</h2>
                    <button class="modal-close-btn" onClick=${onClose}>&times;</button>
                </div>
                <p style="color: #aaa; margin-bottom: 16px;">
                    This will save the current graph as a reusable, minified component.
                </p>
                <input 
                    type="text" 
                    placeholder="Component Name" 
                    value=${name} 
                    onInput=${e => setName(e.target.value)}
                    class="config-rename-input" 
                    style="width: 100%; box-sizing: border-box; margin-bottom: 20px;"
                    autoFocus
                />
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="back-btn" onClick=${onClose}>Cancel</button>
                    <button class="add-node-btn" onClick=${() => onSave(name)}>Save</button>
                </div>
            </div>
        </div>
    `;
};

const SubmitConfigModal = ({ config, onClose, onSubmit }) => {
    const [author, setAuthor] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!author.trim() || !description.trim()) {
            alert("Please provide an author name and description.");
            return;
        }
        setIsSubmitting(true);
        await onSubmit({ ...config, author, description });
        setIsSubmitting(false);
    };

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal-content" onClick=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <h2>Submit to Community</h2>
                    <button class="modal-close-btn" onClick=${onClose}>&times;</button>
                </div>
                <p style="color: #aaa; margin-bottom: 16px;">
                    Download <strong>${config.name}</strong> as a JSON file to share with the community or submit to the repository.
                </p>
                <div class="control-group" style="margin-bottom: 12px;">
                    <label>Author Name</label>
                    <input 
                        type="text" 
                        value=${author} 
                        onInput=${e => setAuthor(e.target.value)}
                        class="config-rename-input" 
                        style="width: 100%; box-sizing: border-box;"
                        placeholder="Your Name"
                    />
                </div>
                <div class="control-group" style="margin-bottom: 20px;">
                    <label>Description</label>
                    <textarea 
                        value=${description} 
                        onInput=${e => setDescription(e.target.value)}
                        style="width: 100%; height: 80px; resize: none;"
                        placeholder="Describe the logic or purpose of this AI..."
                    ></textarea>
                </div>
                 <div class="control-group" style="margin-bottom: 20px;">
                    <label>Preview Payload (JSON)</label>
                    <div class="code-viewer" style="height: 100px; font-size: 0.75rem;">
                        ${JSON.stringify({ ...config, author: author || "...", description: description || "..." }, null, 2)}
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="back-btn" onClick=${onClose} disabled=${isSubmitting}>Cancel</button>
                    <button class="add-node-btn" onClick=${handleSubmit} disabled=${isSubmitting}>
                        ${isSubmitting ? "Generating..." : "Download JSON"}
                    </button>
                </div>
            </div>
        </div>
    `;
}

const EditorView = ({ config, onConfigChange, onBack, savedComponents, onSaveComponent }) => {
    const [nodes, setNodes] = useState(config.nodes);
    const [edges, setEdges] = useState(config.edges);
    const [draggedNode, setDraggedNode] = useState(null);
    const [wiringState, setWiringState] = useState(null);
    const [showTextModal, setShowTextModal] = useState(false);
    const [showSaveModal, setShowSaveModal] = useState(false);
    
    // Refs for stable event handling
    const draggedNodeRef = useRef(draggedNode);
    const wiringStateRef = useRef(wiringState);
    const canvasRef = useRef(null);

    useEffect(() => { draggedNodeRef.current = draggedNode; }, [draggedNode]);
    useEffect(() => { wiringStateRef.current = wiringState; }, [wiringState]);

    useEffect(() => {
        const notes = generateArchitectureNotes(nodes, edges);
        onConfigChange(config.id, { nodes, edges, notes });
    }, [nodes, edges, config.id, onConfigChange]);


    const handleNodeMouseDown = useCallback((e, nodeId) => {
        e.preventDefault();
        e.stopPropagation();
        const node = nodes.find(n => n.id === nodeId);
        if (!node || !node.position) return; 

        setDraggedNode({
            id: nodeId,
            offsetX: e.clientX - node.position.x,
            offsetY: e.clientY - node.position.y
        });
    }, [nodes]);

    // Handle mouse move globally
    const handleMouseMove = useCallback((e) => {
        const currentWiring = wiringStateRef.current;
        const currentDragged = draggedNodeRef.current;

        if (currentWiring) {
            if (canvasRef.current) {
                const canvasRect = canvasRef.current.getBoundingClientRect();
                const mouseX = e.clientX - canvasRect.left;
                const mouseY = e.clientY - canvasRect.top;
                setWiringState(ws => ({ ...ws, endPos: { x: mouseX, y: mouseY } }));
            }
            return;
        }

        if (currentDragged) {
            e.preventDefault();
            // Safety check in case node was deleted while dragging
            setNodes(prevNodes => {
                const nodeExists = prevNodes.some(n => n.id === currentDragged.id);
                if (!nodeExists) return prevNodes;

                const newX = e.clientX - currentDragged.offsetX;
                const newY = e.clientY - currentDragged.offsetY;
                return prevNodes.map(n => n.id === currentDragged.id ? { ...n, position: { x: newX, y: newY } } : n);
            });
        }
    }, []);

    const handleMouseUp = useCallback(() => {
        setDraggedNode(null);
        setWiringState(null);
    }, []);
    
    useEffect(() => {
        const isInteracting = !!draggedNode || !!wiringState;
        if (isInteracting) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggedNode, wiringState, handleMouseMove, handleMouseUp]);


    const handleSocketMouseDown = useCallback((e, nodeId, socketType) => {
        if (socketType !== 'output') return;
        const node = nodes.find(n => n.id === nodeId);
        if (!node || !node.position) return;

        const nodeRadius = 30;
        const startX = node.position.x + (nodeRadius * 2);
        const startY = node.position.y + nodeRadius;
        setWiringState({
            sourceId: nodeId,
            startPos: { x: startX, y: startY },
            endPos: { x: startX, y: startY },
        });
    }, [nodes]);

    const handleSocketMouseUp = useCallback((e, targetNodeId, socketType) => {
        if (socketType !== 'input' || !wiringState) return;

        const { sourceId } = wiringState;
        setWiringState(null);

        if (sourceId === targetNodeId) return; 

        const edgeExists = edges.some(edge => edge.source === sourceId && edge.target === targetNodeId);
        if (edgeExists) return; 
        
        const potentialNewEdges = [...edges, { id: 'temp', source: sourceId, target: targetNodeId }];
        // Cycles are allowed if components are involved (runtime recursion check handles it), 
        // but simple loop check is good for UX.
        if (detectCycle(nodes, potentialNewEdges)) {
            alert("This connection would create a cycle and is not allowed.");
            return;
        }

        const newEdge = { id: generateId('edge'), source: sourceId, target: targetNodeId };
        setEdges([...edges, newEdge]);
    }, [wiringState, edges, nodes]);
    
    const handleEdgeDelete = useCallback((edgeId) => {
        if (window.confirm("Delete this connection?")) {
            setEdges(prevEdges => prevEdges.filter(e => e.id !== edgeId));
        }
    }, []);

    const handleCopy = useCallback((nodeId) => {
        setNodes(prevNodes => {
            const nodeToCopy = prevNodes.find(n => n.id === nodeId);
            if (!nodeToCopy || !nodeToCopy.position) return prevNodes;

            const newNode = {
                ...nodeToCopy,
                id: generateId('node'),
                position: { x: nodeToCopy.position.x + 30, y: nodeToCopy.position.y + 30 }
            };
            return [...prevNodes, newNode];
        });
    }, []);

    const handleDelete = useCallback((nodeId) => {
        if (window.confirm("Are you sure you want to delete this node?")) {
            setNodes(prev => prev.filter(n => n.id !== nodeId));
            setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
        }
    }, []);

    const handleAddNode = () => {
        const newNode = {
            id: generateId('node'),
            position: { x: 100, y: 150 },
        };
        setNodes([...nodes, newNode]);
    };

    const handleAddPreset = (preset) => {
        const idMap = new Map();
        const offsetX = 100 + (Math.random() * 50);
        const offsetY = 150 + (Math.random() * 50);

        const newNodes = preset.nodes.map(n => {
            const newId = generateId('node');
            idMap.set(n.id, newId);
            return {
                id: newId,
                position: { x: n.position.x + offsetX, y: n.position.y + offsetY }
            };
        });

        const newEdges = preset.edges.map(e => ({
            id: generateId('edge'),
            source: idMap.get(e.source),
            target: idMap.get(e.target)
        }));

        setNodes([...nodes, ...newNodes]);
        setEdges([...edges, ...newEdges]);
    };

    const handleAddComponent = (component) => {
        // Adds a SINGLE node that represents the component
        const newNode = {
            id: generateId('node'),
            type: 'component',
            componentId: component.id,
            label: component.name,
            position: { x: 150, y: 150 },
        };
        setNodes([...nodes, newNode]);
    }

    const handleSaveAsComponent = (name) => {
        if (!name) return;
        
        // Deep copy current nodes/edges to freeze the component definition
        // We re-id them to ensure they are self-contained, though simple clone is fine too if we are careful.
        // Let's standardise the positions relative to top-left to look nice if we ever expand them.
        const minX = Math.min(...nodes.map(n => n.position.x));
        const minY = Math.min(...nodes.map(n => n.position.y));

        const componentNodes = nodes.map(n => ({
            ...n,
            position: { x: n.position.x - minX, y: n.position.y - minY }
        }));
        
        const componentEdges = [...edges];

        const newComponent = {
            id: generateId('comp'),
            name: name,
            nodes: componentNodes,
            edges: componentEdges
        };

        onSaveComponent(newComponent);
        setShowSaveModal(false);
    };

    const getWiringPath = () => {
        if (!wiringState || !wiringState.startPos || !wiringState.endPos) return "";
        const { startPos, endPos } = wiringState;
        return `M ${startPos.x} ${startPos.y} L ${endPos.x} ${endPos.y}`;
    };

    return html`
        <div class="app-root editor-mode">
            <div class="app-header">
                <h1>Editing: ${config.name}</h1>
                <div class="header-controls">
                  <div class="dropdown">
                      <button class="add-node-btn">+ Add Node / Preset</button>
                      <div class="dropdown-content">
                          <div class="dropdown-item" onClick=${handleAddNode}>Single Node</div>
                          <div style="border-top: 1px solid #444; margin: 4px 0;"></div>
                          <div class="dropdown-label" style="padding: 4px 16px; color: #888; font-size: 0.8em;">PRESETS</div>
                          ${PRESETS.map(p => html`
                             <div class="dropdown-item" onClick=${() => handleAddPreset(p)}>${p.name}</div>
                          `)}
                          ${savedComponents.length > 0 && html`
                            <div style="border-top: 1px solid #444; margin: 4px 0;"></div>
                            <div class="dropdown-label" style="padding: 4px 16px; color: #888; font-size: 0.8em;">CUSTOM COMPONENTS</div>
                             ${savedComponents.map(c => html`
                                <div class="dropdown-item" onClick=${() => handleAddComponent(c)}>📦 ${c.name}</div>
                             `)}
                          `}
                      </div>
                  </div>
                  <button class="icon-btn" title="Save as Component" onClick=${() => setShowSaveModal(true)}>💾 Save as Component</button>
                  <button class="icon-btn" title="View Graph Text" onClick=${() => setShowTextModal(true)}>📜 View Code</button>
                  <button class="back-btn" onClick=${onBack}>← Back</button>
                </div>
            </div>
            <div class="main-container">
                <main class="canvas" ref=${canvasRef}>
                    <svg class="edges-svg">
                        ${edges.map(edge => h(Edge, { edge, nodes, onClick: handleEdgeDelete }))}
                        ${wiringState && html`<path class="edge-path-wiring" d=${getWiringPath()} />`}
                    </svg>
                    ${nodes.map(node => h(Node, {
                        data: node,
                        onMouseDown: handleNodeMouseDown,
                        onSocketMouseDown: handleSocketMouseDown,
                        onSocketMouseUp: handleSocketMouseUp,
                        onCopy: handleCopy,
                        onDelete: handleDelete
                    }))}
                </main>
            </div>
            ${showTextModal && h(TextViewModal, { 
                content: generateMermaid(nodes, edges), 
                onClose: () => setShowTextModal(false) 
            })}
             ${showSaveModal && h(SaveComponentModal, { 
                onClose: () => setShowSaveModal(false),
                onSave: handleSaveAsComponent
            })}
        </div>
    `;
};


// --- MAIN APP ---

const App = () => {
  const [configurations, setConfigurations] = useState(INITIAL_CONFIGURATIONS);
  const [savedComponents, setSavedComponents] = useState([]);
  const [view, setView] = useState('list');
  const [activeConfigId, setActiveConfigId] = useState(null);
  const [testConfigId, setTestConfigId] = useState(INITIAL_CONFIGURATIONS[0]?.id || null);
  const [renamingConfigId, setRenamingConfigId] = useState(null);
  const [submitModalConfig, setSubmitModalConfig] = useState(null);

  const [selectedQuizName, setSelectedQuizName] = useState(QUIZZES[0].name);
  const [quizResults, setQuizResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const handleUpdateConfig = useCallback((configId, updates) => {
      setConfigurations(configs => configs.map(c => 
          c.id === configId ? { ...c, ...updates } : c
      ));
  }, []);

  const handleSaveComponent = useCallback((component) => {
      setSavedComponents(prev => [...prev, component]);
  }, []);

  const handleRunQuiz = async () => {
    const configToRun = configurations.find(c => c.id === testConfigId);
    if (!configToRun || !configToRun.nodes.length) {
        setQuizResults([{ question: "Error", answer: "Please select a configuration with nodes to test." }]);
        return;
    }
    if (!ai) {
      setQuizResults([{ question: "Error", answer: "Gemini API key not configured. Check environment variables." }]);
      return;
    }
    
    setIsLoading(true);
    setQuizResults(null);
    
    const selectedQuiz = QUIZZES.find(q => q.name === selectedQuizName);
    if (!selectedQuiz) {
        setIsLoading(false);
        return;
    }

    try {
        const results = await Promise.all(selectedQuiz.questions.map(async (question) => {
            try {
                // Call the engine with the current config
                const answer = await runGraphEngine(
                    configToRun.nodes, 
                    configToRun.edges, 
                    question, 
                    "", 
                    ai, 
                    savedComponents
                );
                return { question, answer };
            } catch (err) {
                return { question, answer: `Error: ${err.message}` };
            }
        }));
        setQuizResults(results);
    } catch(error) {
      console.error("AI Quiz Error:", error);
      setQuizResults([{ question: "Quiz Failed", answer: `An error occurred: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNewConfig = () => {
    const newNodes = createDefaultNodes();
    const newEdges = createDefaultEdges();
    const newConfig = {
      id: generateId('config'),
      name: `New AI ${configurations.length + 1}`,
      nodes: newNodes,
      edges: newEdges,
      notes: generateArchitectureNotes(newNodes, newEdges),
    };
    setConfigurations([...configurations, newConfig]);
    setTestConfigId(newConfig.id);
  };
  
  const handleCopyConfig = (configId) => {
    const configToCopy = configurations.find(c => c.id === configId);
    if (!configToCopy) return;

    const idMap = new Map();
    const newNodes = configToCopy.nodes.map(node => {
        const newId = generateId('node');
        idMap.set(node.id, newId);
        return {
            ...node,
            id: newId,
            position: { x: node.position.x + 20, y: node.position.y + 20 }
        };
    });

    const newEdges = configToCopy.edges.map(edge => ({
        ...edge,
        id: generateId('edge'),
        source: idMap.get(edge.source),
        target: idMap.get(edge.target),
    }));
    
    const newConfig = {
        id: generateId('config'),
        name: `${configToCopy.name} (Copy)`,
        nodes: newNodes,
        edges: newEdges,
        notes: generateArchitectureNotes(newNodes, newEdges),
    };
    setConfigurations([...configurations, newConfig]);
  };

  const handleMegafyConfig = (configId) => {
    const configToMegafy = configurations.find(c => c.id === configId);
    if (!configToMegafy || configToMegafy.nodes.length === 0) {
        alert("Cannot Mega-fy an empty configuration.");
        return;
    }

    // 1. Create a Component definition from the current config
    
    // Normalize positions for the component definition
    const minX = Math.min(...configToMegafy.nodes.map(n => n.position.x));
    const minY = Math.min(...configToMegafy.nodes.map(n => n.position.y));

    const componentNodes = configToMegafy.nodes.map(n => ({
        ...n,
        position: { x: n.position.x - minX, y: n.position.y - minY }
    }));
    
    const newComponentId = generateId('comp');
    const newComponent = {
        id: newComponentId,
        name: configToMegafy.name,
        nodes: componentNodes,
        edges: [...configToMegafy.edges]
    };

    // 2. Add this new component to the registry so the new nodes can find it
    setSavedComponents(prev => [...prev, newComponent]);

    // 3. Create the Mega-fied Config
    //    It has the SAME topology (nodes/edges) as the original.
    //    BUT, every node is now a reference to `newComponent`.
    
    const idMap = new Map();
    const megaNodes = configToMegafy.nodes.map(node => {
        const newId = generateId('node');
        idMap.set(node.id, newId);
        
        return {
            id: newId,
            position: { ...node.position },
            type: 'component',
            componentId: newComponentId,
            label: configToMegafy.name // Label it with the component name
        };
    });

    const megaEdges = configToMegafy.edges.map(edge => ({
        id: generateId('edge'),
        source: idMap.get(edge.source),
        target: idMap.get(edge.target),
    }));

    const newConfig = {
        id: generateId('config'),
        name: `Mega-${configToMegafy.name}`,
        nodes: megaNodes,
        edges: megaEdges,
        notes: generateArchitectureNotes(megaNodes, megaEdges),
    };

    setConfigurations(prev => [...prev, newConfig]);
  };
  
  const handleDeleteConfig = (configId) => {
      if (window.confirm("Are you sure you want to delete this AI configuration?")) {
          let newConfigs = configurations.filter(c => c.id !== configId);
          if (newConfigs.length === 0) {
             const newNodes = createDefaultNodes();
             const newEdges = createDefaultEdges();
             newConfigs = [{
                id: generateId('config'),
                name: "New AI",
                nodes: newNodes,
                edges: newEdges,
                notes: generateArchitectureNotes(newNodes, newEdges)
             }];
          }
          setConfigurations(newConfigs);
          if (testConfigId === configId || !newConfigs.find(c => c.id === testConfigId)) {
              setTestConfigId(newConfigs[0].id);
          }
      }
  };
  
  const handleFinishRename = (configId, newName) => {
    setConfigurations(configurations.map(c => 
      c.id === configId ? { ...c, name: newName || c.name } : c
    ));
    setRenamingConfigId(null);
  };
  
  const handleEditConfig = (configId) => {
    setActiveConfigId(configId);
    setView('editor');
  };

  const handleSubmitConfig = async (submittedData) => {
    // Generates a JSON file for the user to download
    const dataStr = JSON.stringify(submittedData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    const safeName = submittedData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `submission-${safeName}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    alert(`Configuration downloaded! Please submit this file to the community database (e.g. via GitHub Issue or Email).`);
    setSubmitModalConfig(null);
  };

  const activeConfigForEdit = useMemo(() => configurations.find(c => c.id === activeConfigId), [configurations, activeConfigId]);

  if (view === 'editor' && activeConfigForEdit) {
    return h(EditorView, {
      config: activeConfigForEdit,
      onConfigChange: handleUpdateConfig,
      onBack: () => setView('list'),
      savedComponents: savedComponents,
      onSaveComponent: handleSaveComponent
    });
  }

  const testConfig = configurations.find(c => c.id === testConfigId);

  return html`
    <div class="app-root list-mode">
        <div class="app-header">
            <h1>AI Configurations</h1>
            <button class="add-node-btn" onClick=${handleCreateNewConfig}>+ New Configuration</button>
        </div>
        <div class="main-container">
            <main class="config-list-container">
                ${configurations.map(config => html`
                    <div 
                      class="config-card ${config.id === testConfigId ? 'selected' : ''}"
                      onClick=${() => setTestConfigId(config.id)}
                    >
                        <div class="config-card-header">
                            ${renamingConfigId === config.id ? html`
                                <input 
                                    type="text" 
                                    class="config-rename-input"
                                    value=${config.name}
                                    onClick=${e => e.stopPropagation()}
                                    onBlur=${(e) => handleFinishRename(config.id, e.target.value)}
                                    onKeyDown=${(e) => { if (e.key === 'Enter') handleFinishRename(config.id, e.target.value) }}
                                    autoFocus
                                />
                            ` : html`
                                <h3 class="config-name">${config.name}</h3>
                            `}
                        </div>
                        <div class="config-card-actions">
                            <button onClick=${(e) => { e.stopPropagation(); setTestConfigId(config.id)}}>Test</button>
                            <button onClick=${(e) => { e.stopPropagation(); handleEditConfig(config.id) }}>Edit</button>
                            <button onClick=${(e) => { e.stopPropagation(); setRenamingConfigId(config.id) }}>Rename</button>
                            <button onClick=${(e) => { e.stopPropagation(); handleCopyConfig(config.id) }}>Copy</button>
                            <button class="mega-btn" onClick=${(e) => { e.stopPropagation(); handleMegafyConfig(config.id) }} title="Recursive: Turn every node into a copy of this graph">Mega-fy</button>
                            <button onClick=${(e) => { e.stopPropagation(); setSubmitModalConfig(config) }}>Submit</button>
                            <button class="danger" onClick=${(e) => { e.stopPropagation(); handleDeleteConfig(config.id) }}>Delete</button>
                        </div>
                    </div>
                `)}
            </main>
            <aside class="control-panel">
                <h2>Test Your AI</h2>
                ${!testConfig ? html`
                  <div class="panel-placeholder">Select or create a configuration to test.</div>
                ` : html`
                  <div class="control-group">
                    <label>Testing Configuration</label>
                    <div class="active-config-name">${testConfig.name}</div>
                  </div>
                  <div class="control-group">
                      <label for="quiz-select">Select Quiz</label>
                      <select id="quiz-select" class="quiz-select" value=${selectedQuizName} onInput=${(e) => setSelectedQuizName(e.target.value)}>
                        ${QUIZZES.map(quiz => html`<option value=${quiz.name}>${quiz.name}</option>`)}
                      </select>
                  </div>
                  <button class="run-btn" onClick=${handleRunQuiz} disabled=${isLoading}>
                      ${isLoading ? "Running Quiz..." : "Run Quiz"}
                  </button>
                  <div class="control-group output-group">
                      <label for="output-area">Output</label>
                      <div id="output-area" class="output-area ${isLoading ? 'loading-indicator' : ''}">
                          ${isLoading && !quizResults ? 'Running...' : ''}
                          ${!isLoading && !quizResults ? 'Run a quiz to see the results.' : ''}
                          ${quizResults && quizResults.map(result => html`
                            <div class="quiz-result-item">
                                <h4 class="quiz-question">${result.question}</h4>
                                <p class="quiz-answer">${result.answer}</p>
                            </div>
                          `)}
                      </div>
                  </div>
                  <div class="control-group output-group">
                      <label for="notepad-area">Architecture Report</label>
                      <div id="notepad-area" class="notepad-area readonly-notepad">
                        ${testConfig.notes || 'Notes will be auto-generated when you edit the configuration.'}
                      </div>
                  </div>
                `}
            </aside>
        </div>
        ${submitModalConfig && h(SubmitConfigModal, {
            config: submitModalConfig,
            onClose: () => setSubmitModalConfig(null),
            onSubmit: handleSubmitConfig
        })}
        <div class="nerd-zone">
            <details>
                <summary>How It Works (For Nerds)</summary>
                <div class="nerd-content">
                    <p style=${{marginBottom: '16px'}}>This application is designed to demonstrate that an AI's behavior can be defined purely by its internal structure. Here's a peek under the hood:</p>
                    <ul>
                        <li>
                            <h4>Unified Node System</h4>
                            <p>Every node is functionally identical, powered by the same universal prompt. There are no special "input" or "output" nodes. This forces the focus onto the architecture of the graph, as it's the only thing you can change.</p>
                        </li>
                        <li>
                            <h4>Custom Components (Minified Presets)</h4>
                            <p>You can save an entire graph as a "Component". This creates a single "Black Box" node (marked with 📦) that represents the saved architecture. When the execution engine reaches this node, it recursively executes the saved internal graph, passing the input from the outer graph into the roots of the inner graph, and bubbling the results back up.</p>
                        </li>
                        <li>
                            <h4>Topological Sort Execution</h4>
                            <p>When you run a quiz, the system doesn't process nodes randomly. It performs a <a href="https://en.wikipedia.org/wiki/Topological_sorting" target="_blank" rel="noopener noreferrer">topological sort</a> on the graph to create a logical, ordered execution plan. It starts with "root" nodes (those with no inputs) and only processes a node once all its parents are complete. This prevents infinite loops in cycles and ensures information flows correctly.</p>
                        </li>
                        <li>
                            <h4>Dynamic Prompt Generation</h4>
                            <p>For each node in the execution sequence, the application dynamically builds a prompt to send to the Gemini API. It replaces the <code>${'{{user_prompt}}'}</code> placeholder with the current quiz question and the <code>${'{{input}}'}</code> placeholder with the combined text outputs from all direct parent nodes. If a node has multiple parents, their outputs are joined together with a separator, forcing the node to synthesize or integrate multiple lines of thought.</p>
                        </li>
                         <li>
                            <h4>Wiring & Architecture Examples</h4>
                            <p>The wiring is the *only* thing that defines the AI's thought process. Here’s what different structures do:</p>
                            <div class="nerd-example">
                                <h5>Linear Chain (A → B → C)</h5>
                                <p>This is an assembly line. The output of <code>A</code> becomes the input for <code>B</code>. <code>B</code> refines it, and its output becomes the input for <code>C</code>. This is good for sequential tasks like drafting, refining, and then summarizing an idea.</p>
                            </div>
                            <div class="nerd-example">
                                <h5>Parallel Processing / Branching (A → B, A → C)</h5>
                                <p>This is a brainstorm. <code>A</code> generates an idea, and both <code>B</code> and <code>C</code> receive that same idea as input. They process it independently, creating two separate lines of thought. This is useful for exploring pros and cons, or generating multiple creative options from a single prompt.</p>
                            </div>
                            <div class="nerd-example">
                                <h5>Merging / Synthesis (B → D, C → D)</h5>
                                <p>This is a committee meeting. Node <code>D</code> receives the outputs from *both* <code>B</code> and <code>C</code>. The text from both parents is joined together with a separator and passed into <code>D</code>'s <code>${'{{input}}'}</code> placeholder. The universal prompt then instructs <code>D</code> to build upon this combined text, forcing it to synthesize the two independent ideas.</p>
                            </div>
                             <div class="nerd-example">
                                <h5>Isolated Nodes (A, B)</h5>
                                <p>This creates fragmented results. Since neither node has an input, they both act as root nodes. They both receive the original <code>${'{{user_prompt}}'}</code> and produce completely independent outputs. The final answer is simply both of their outputs listed together.</p>
                            </div>
                        </li>
                    </ul>
                </div>
            </details>
        </div>
    </div>
  `;
};

render(h(App, null), document.getElementById("app"));