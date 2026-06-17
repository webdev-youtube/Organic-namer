import React from 'react';

export type DrawTool = 'move' | 'atom' | 'bond';

interface Props {
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  selectedBondOrder: 1 | 2 | 3;
  setSelectedBondOrder: (o: 1 | 2 | 3) => void;
  selectedElement: string;
}

const BOND_OPTIONS: { order: 1 | 2 | 3; symbol: string; label: string }[] = [
  { order: 1, symbol: '─', label: 'Single' },
  { order: 2, symbol: '═', label: 'Double' },
  { order: 3, symbol: '≡', label: 'Triple' },
];

export default function DrawingToolbar({ tool, setTool, selectedBondOrder, setSelectedBondOrder, selectedElement }: Props) {
  const btnBase = 'flex flex-col items-center justify-center gap-0.5 w-full rounded-lg transition-colors select-none';
  const btnActive = 'bg-primary text-primary-foreground';
  const btnIdle = 'text-muted-foreground hover:text-foreground hover:bg-muted';

  return (
    <div
      className="flex flex-col items-center gap-1 px-1.5 py-2 border-r border-border bg-card shrink-0"
      style={{ width: 58 }}
    >
      {/* ── Move / Pan ── */}
      <button
        title="Move / Pan canvas"
        data-testid="tool-move"
        onClick={() => setTool('move')}
        className={`${btnBase} h-12 ${tool === 'move' ? btnActive : btnIdle}`}
      >
        <span className="text-xl leading-none">✥</span>
        <span className="text-[10px] font-medium leading-none">Move</span>
      </button>

      {/* ── Place Atom ── */}
      <button
        title="Place atom"
        data-testid="tool-atom"
        onClick={() => setTool('atom')}
        className={`${btnBase} h-12 ${tool === 'atom' ? btnActive : btnIdle}`}
      >
        <span className="text-base font-bold leading-none">{selectedElement}</span>
        <span className="text-[10px] font-medium leading-none">Atom</span>
      </button>

      {/* ── Bond ── */}
      <button
        title="Draw bond"
        data-testid="tool-bond"
        onClick={() => setTool('bond')}
        className={`${btnBase} h-12 ${tool === 'bond' ? btnActive : btnIdle}`}
      >
        <span className="text-xl font-mono leading-none">
          {BOND_OPTIONS.find(b => b.order === selectedBondOrder)?.symbol}
        </span>
        <span className="text-[10px] font-medium leading-none">Bond</span>
      </button>

      {/* Bond order sub-buttons — only when bond tool active */}
      {tool === 'bond' && (
        <div className="flex flex-col items-center gap-0.5 w-full">
          {BOND_OPTIONS.map(({ order, symbol, label }) => (
            <button
              key={order}
              title={`${label} bond`}
              data-testid={`bond-order-${order}`}
              onClick={() => setSelectedBondOrder(order)}
              className={[
                'w-full h-8 rounded-md font-mono text-sm transition-colors',
                selectedBondOrder === order
                  ? 'bg-emerald-600 text-white'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {symbol}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* ── Divider ── */}
      <div className="w-8 h-px bg-border" />

      {/* ── Erase ── */}
      <button
        title="Erase tool — click atoms or bonds to delete"
        data-testid="tool-erase"
        onClick={() => setTool('atom')}   /* placeholder: erase uses atom tool + right-click */
        className={`${btnBase} h-10 ${btnIdle}`}
      >
        <span className="text-base leading-none">⌫</span>
        <span className="text-[10px] font-medium leading-none">Erase</span>
      </button>
    </div>
  );
}
