import React, { useState, useRef, MouseEvent, TouchEvent } from 'react';
import { useMolecule } from '../context/MoleculeContext';
import { v4 as uuidv4 } from 'uuid';
import type { DrawTool } from './DrawingToolbar';

export default function MoleculeCanvas({
  selectedElement,
  selectedBondOrder,
  tool,
}: {
  selectedElement: string;
  selectedBondOrder: 1 | 2 | 3;
  tool: DrawTool;
}) {
  const { graph, addAtom, addBond, removeAtom, setBondOrder, cycleBond, namingResult, showAnalysis } = useMolecule();
  const svgRef = useRef<SVGSVGElement>(null);

  // Pan offset (for Move tool)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  // Draw state
  const [dragStartId, setDragStartId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const dragMoved = useRef(false);
  const suppressClick = useRef(false);
  const justTouched = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const bondTapMoved = useRef(false);

  // ─── Coordinate helpers ────────────────────────────────────────────────────

  function getSvgPoint(clientX: number, clientY: number) {
    const CTM = svgRef.current!.getScreenCTM()!;
    return {
      x: (clientX - CTM.e) / CTM.a - pan.x,
      y: (clientY - CTM.f) / CTM.d - pan.y,
    };
  }
  function mousePos_(e: MouseEvent) { return getSvgPoint(e.clientX, e.clientY); }

  /** Walk DOM from elementFromPoint upward looking for data-atom-id. */
  function findAtomAtPoint(cx: number, cy: number): string | null {
    let el = document.elementFromPoint(cx, cy);
    while (el) {
      const id = el.getAttribute('data-atom-id');
      if (id) return id;
      el = el.parentElement;
    }
    return null;
  }

  function cancelLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  // ─── Move/Pan tool ────────────────────────────────────────────────────────

  function startPan(clientX: number, clientY: number) {
    panStart.current = { mx: clientX, my: clientY, px: pan.x, py: pan.y };
  }
  function movePan(clientX: number, clientY: number) {
    if (!panStart.current) return;
    const CTM = svgRef.current?.getScreenCTM();
    const scale = CTM ? CTM.a : 1;
    const dx = (clientX - panStart.current.mx) / scale;
    const dy = (clientY - panStart.current.my) / scale;
    setPan({ x: panStart.current.px + dx, y: panStart.current.py + dy });
  }
  function endPan() { panStart.current = null; }

  // ─── Mouse handlers ────────────────────────────────────────────────────────

  const handleSvgMouseDown = (e: MouseEvent) => {
    if (tool === 'move') { e.preventDefault(); startPan(e.clientX, e.clientY); }
  };

  const handleSvgMouseMove = (e: MouseEvent) => {
    if (tool === 'move' && panStart.current) { movePan(e.clientX, e.clientY); return; }
    if (dragStartId) { dragMoved.current = true; setMousePos(mousePos_(e)); }
  };

  const handleSvgMouseUp = (e: MouseEvent) => {
    if (tool === 'move') { endPan(); return; }
    if (dragStartId && dragMoved.current) {
      const pt = mousePos_(e);
      const newId = uuidv4();
      addAtom({ id: newId, element: selectedElement, x: pt.x, y: pt.y });
      addBond({ id: uuidv4(), atom1Id: dragStartId, atom2Id: newId, order: selectedBondOrder });
      suppressClick.current = true;
    }
    setDragStartId(null);
    dragMoved.current = false;
  };

  const handleSvgClick = (e: MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (justTouched.current) { justTouched.current = false; return; }
    if (tool === 'move') return;
    if (tool === 'bond') return; // bond tool requires drag from existing atom
    // atom tool: place atom
    const pt = mousePos_(e);
    addAtom({ id: uuidv4(), element: selectedElement, x: pt.x, y: pt.y });
  };

  const handleAtomMouseDown = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    suppressClick.current = true;
    if (tool === 'move') return;
    if (e.button === 2) { removeAtom(id); suppressClick.current = false; return; }
    setDragStartId(id);
    dragMoved.current = false;
    setMousePos(mousePos_(e));
  };

  const handleAtomMouseUp = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (tool === 'move') return;
    if (dragStartId && dragStartId !== id && dragMoved.current) {
      const exists = graph.bonds.some(b =>
        (b.atom1Id === id && b.atom2Id === dragStartId) ||
        (b.atom1Id === dragStartId && b.atom2Id === id)
      );
      if (!exists) addBond({ id: uuidv4(), atom1Id: dragStartId, atom2Id: id, order: selectedBondOrder });
    }
    setDragStartId(null);
    dragMoved.current = false;
    suppressClick.current = true;
  };

  const handleBondContextMenu = (e: MouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    cycleBond(id);
  };

  // ─── Touch handlers ────────────────────────────────────────────────────────

  const handleSvgTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    justTouched.current = true;
    const t = e.touches[0];
    if (tool === 'move') { startPan(t.clientX, t.clientY); return; }
    dragMoved.current = false;
    didLongPress.current = false;
    setMousePos(getSvgPoint(t.clientX, t.clientY));
  };

  const handleSvgTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    cancelLongPress();
    const t = e.touches[0];
    if (tool === 'move') { movePan(t.clientX, t.clientY); return; }
    dragMoved.current = true;
    setMousePos(getSvgPoint(t.clientX, t.clientY));
  };

  const handleSvgTouchEnd = (e: TouchEvent) => {
    justTouched.current = true;
    cancelLongPress();
    if (tool === 'move') { endPan(); return; }
    if (!dragMoved.current && tool !== 'bond') {
      const ch = e.changedTouches[0];
      const pt = getSvgPoint(ch.clientX, ch.clientY);
      addAtom({ id: uuidv4(), element: selectedElement, x: pt.x, y: pt.y });
    }
    dragMoved.current = false;
  };

  const handleAtomTouchStart = (e: TouchEvent, id: string) => {
    e.stopPropagation();
    if (e.touches.length !== 1) return;
    justTouched.current = true;
    if (tool === 'move') return;
    dragMoved.current = false;
    didLongPress.current = false;
    setDragStartId(id);
    const t = e.touches[0];
    setMousePos(getSvgPoint(t.clientX, t.clientY));

    // Long-press = delete atom
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      removeAtom(id);
      setDragStartId(null);
    }, 500);
  };

  const handleAtomTouchEnd = (e: TouchEvent, startId: string) => {
    e.stopPropagation();
    justTouched.current = true;
    cancelLongPress();
    if (didLongPress.current) { setDragStartId(null); dragMoved.current = false; return; }
    if (tool === 'move') return;

    const ch = e.changedTouches[0];
    const targetId = findAtomAtPoint(ch.clientX, ch.clientY);

    if (dragMoved.current) {
      if (targetId && targetId !== startId) {
        // Bond to existing atom
        const exists = graph.bonds.some(b =>
          (b.atom1Id === startId && b.atom2Id === targetId) ||
          (b.atom1Id === targetId && b.atom2Id === startId)
        );
        if (!exists) addBond({ id: uuidv4(), atom1Id: startId, atom2Id: targetId, order: selectedBondOrder });
      } else if (!targetId) {
        // Bond to new atom at lift position
        const pt = getSvgPoint(ch.clientX, ch.clientY);
        const newId = uuidv4();
        addAtom({ id: newId, element: selectedElement, x: pt.x, y: pt.y });
        addBond({ id: uuidv4(), atom1Id: startId, atom2Id: newId, order: selectedBondOrder });
      }
    }
    // Tap on atom (no drag): do nothing extra

    setDragStartId(null);
    dragMoved.current = false;
  };

  const handleBondTouchStart = (e: TouchEvent) => { e.stopPropagation(); bondTapMoved.current = false; };
  const handleBondTouchMove = () => { bondTapMoved.current = true; };
  const handleBondTouchEnd = (e: TouchEvent, id: string) => {
    e.stopPropagation();
    justTouched.current = true;
    if (!bondTapMoved.current) setBondOrder(id, selectedBondOrder);
    bondTapMoved.current = false;
  };

  // ─── Visual helpers ────────────────────────────────────────────────────────

  const getAtomColor = (id: string) => {
    if (!showAnalysis || !namingResult) return 'white';
    if (namingResult.parentChainAtomIds.includes(id)) return '#60a5fa';
    if (namingResult.functionalGroupAtomIds.includes(id)) return '#fbbf24';
    if (namingResult.substituentAtomIds.includes(id)) return '#34d399';
    return 'white';
  };

  const getBondColor = (b: { atom1Id: string; atom2Id: string }) => {
    if (!showAnalysis || !namingResult) return '#6b7280';
    if (namingResult.parentChainAtomIds.includes(b.atom1Id) && namingResult.parentChainAtomIds.includes(b.atom2Id)) return '#60a5fa';
    return '#6b7280';
  };

  const cursor = tool === 'move' ? (panStart.current ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair';

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <svg
      ref={svgRef}
      className={`w-full h-full bg-[#09090b] touch-none select-none ${cursor}`}
      onClick={handleSvgClick}
      onMouseDown={handleSvgMouseDown}
      onMouseMove={handleSvgMouseMove}
      onMouseUp={handleSvgMouseUp}
      onMouseLeave={handleSvgMouseUp}
      onContextMenu={e => e.preventDefault()}
      onTouchStart={handleSvgTouchStart}
      onTouchMove={handleSvgTouchMove}
      onTouchEnd={handleSvgTouchEnd}
    >
      {/* Pan group */}
      <g transform={`translate(${pan.x}, ${pan.y})`}>

        {/* Bonds */}
        {graph.bonds.map(bond => {
          const a1 = graph.atoms.find(a => a.id === bond.atom1Id);
          const a2 = graph.atoms.find(a => a.id === bond.atom2Id);
          if (!a1 || !a2) return null;
          const col = getBondColor(bond);
          const dx = a2.x - a1.x, dy = a2.y - a1.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const off = 5;
          return (
            <g
              key={bond.id}
              onContextMenu={e => handleBondContextMenu(e, bond.id)}
              onTouchStart={handleBondTouchStart}
              onTouchMove={handleBondTouchMove}
              onTouchEnd={e => handleBondTouchEnd(e, bond.id)}
            >
              <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} stroke="transparent" strokeWidth={22} className="cursor-pointer" />
              {bond.order === 1 && <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} stroke={col} strokeWidth={2.5} strokeLinecap="round" />}
              {bond.order === 2 && <>
                <line x1={a1.x + nx*off} y1={a1.y + ny*off} x2={a2.x + nx*off} y2={a2.y + ny*off} stroke={col} strokeWidth={2.5} strokeLinecap="round" />
                <line x1={a1.x - nx*off} y1={a1.y - ny*off} x2={a2.x - nx*off} y2={a2.y - ny*off} stroke={col} strokeWidth={2.5} strokeLinecap="round" />
              </>}
              {bond.order === 3 && <>
                <line x1={a1.x + nx*off} y1={a1.y + ny*off} x2={a2.x + nx*off} y2={a2.y + ny*off} stroke={col} strokeWidth={2} strokeLinecap="round" />
                <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} stroke={col} strokeWidth={2} strokeLinecap="round" />
                <line x1={a1.x - nx*off} y1={a1.y - ny*off} x2={a2.x - nx*off} y2={a2.y - ny*off} stroke={col} strokeWidth={2} strokeLinecap="round" />
              </>}
            </g>
          );
        })}

        {/* Drag preview */}
        {dragStartId && (() => {
          const src = graph.atoms.find(a => a.id === dragStartId);
          if (!src) return null;
          return <line x1={src.x} y1={src.y} x2={mousePos.x} y2={mousePos.y} stroke="#4b5563" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />;
        })()}

        {/* Atoms */}
        {(() => {
          // Compute ring centroid for outward label placement
          const ringAtomIds = new Set(namingResult?.parentChainAtomIds ?? []);
          const ringAtoms = graph.atoms.filter(a => ringAtomIds.has(a.id));
          const isRingMolecule = ringAtoms.length >= 3;
          const centroid = isRingMolecule
            ? { x: ringAtoms.reduce((s, a) => s + a.x, 0) / ringAtoms.length,
                y: ringAtoms.reduce((s, a) => s + a.y, 0) / ringAtoms.length }
            : { x: 0, y: 0 };

          return graph.atoms.map(atom => {
            const isC = atom.element === 'C';
            const deg = graph.bonds.filter(b => b.atom1Id === atom.id || b.atom2Id === atom.id).length;
            const showSym = !isC || deg === 0 || deg === 1;
            const col = getAtomColor(atom.id);
            const locant = showAnalysis ? namingResult?.numbering.get(atom.id) : undefined;

            // Compute label offset to avoid overlapping the atom/bonds
            let labelX = 16, labelY = -16;
            if (locant != null) {
              if (isRingMolecule && ringAtomIds.has(atom.id)) {
                // Push outward from ring centroid
                const dx = atom.x - centroid.x;
                const dy = atom.y - centroid.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                labelX = (dx / dist) * 22;
                labelY = (dy / dist) * 22;
              } else {
                // Offset away from the average bonded-neighbor direction
                const bondedNbrs = graph.bonds
                  .filter(b => b.atom1Id === atom.id || b.atom2Id === atom.id)
                  .map(b => graph.atoms.find(a => a.id === (b.atom1Id === atom.id ? b.atom2Id : b.atom1Id)))
                  .filter(Boolean) as typeof graph.atoms;
                if (bondedNbrs.length > 0) {
                  const avgX = bondedNbrs.reduce((s, a) => s + a.x, 0) / bondedNbrs.length;
                  const avgY = bondedNbrs.reduce((s, a) => s + a.y, 0) / bondedNbrs.length;
                  const dx = atom.x - avgX;
                  const dy = atom.y - avgY;
                  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                  labelX = (dx / dist) * 14;
                  labelY = (dy / dist) * 14;
                }
              }
            }

            return (
              <g
                key={atom.id}
                data-atom-id={atom.id}
                transform={`translate(${atom.x}, ${atom.y})`}
                onMouseDown={e => handleAtomMouseDown(e, atom.id)}
                onMouseUp={e => handleAtomMouseUp(e, atom.id)}
                onTouchStart={e => handleAtomTouchStart(e, atom.id)}
                onTouchEnd={e => handleAtomTouchEnd(e, atom.id)}
                className="cursor-pointer"
              >
                <circle r={22} fill="transparent" data-atom-id={atom.id} />
                {showSym
                  ? <text textAnchor="middle" dominantBaseline="central" fill={col} fontSize={15} fontWeight="bold" fontFamily="system-ui,sans-serif" pointerEvents="none">{atom.element}</text>
                  : <circle r={3.5} fill={col} pointerEvents="none" />
                }
                {locant != null && (
                  <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="central" fill="#60a5fa" fontSize={11} fontWeight="bold" fontFamily="monospace" pointerEvents="none">{locant}</text>
                )}
              </g>
            );
          });
        })()}
      </g>
    </svg>
  );
}
