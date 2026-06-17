import React, { useState } from 'react';
import MoleculeCanvas from '@/components/MoleculeCanvas';
import ExplanationPanel from '@/components/ExplanationPanel';
import DrawingToolbar, { DrawTool } from '@/components/DrawingToolbar';
import { useMolecule } from '@/context/MoleculeContext';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { presets } from '@/lib/presets';

const ELEMENTS = ['C', 'O', 'N', 'S', 'F', 'Cl', 'Br', 'I', 'P'];

export default function Home() {
  const [selectedElement, setSelectedElement] = useState('C');
  const [selectedBondOrder, setSelectedBondOrder] = useState<1 | 2 | 3>(1);
  const [tool, setTool] = useState<DrawTool>('atom');
  const [showResults, setShowResults] = useState(false);
  const { clear, analyze, setGraph, showAnalysis, setShowAnalysis, namingResult } = useMolecule();

  const handlePreset = (val: string) => {
    if (presets[val]) {
      clear();
      setGraph(JSON.parse(JSON.stringify(presets[val])));
      setShowAnalysis(false);
      setShowResults(false);
    }
  };

  const handleAnalyze = () => { analyze(); setShowResults(true); };

  // When bond tool is picked from toolbar, also update bond order sub-selection visually
  const handleSetTool = (t: DrawTool) => {
    setTool(t);
  };

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-background text-foreground dark overflow-hidden">

      {/* ── Desktop header ──────────────────────────────────────────────── */}
      <header className="hidden md:flex h-13 border-b border-border px-3 items-center justify-between shrink-0 bg-card" style={{ height: 52 }}>
        <div className="flex items-center gap-3">
          <span className="font-bold text-base tracking-tight">ChemName</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm">PRO</span>
          <div className="h-5 w-px bg-border" />
          {/* Element picker */}
          <div className="flex items-center gap-0.5">
            {ELEMENTS.map(el => (
              <button
                key={el}
                onClick={() => { setSelectedElement(el); if (tool !== 'atom') setTool('atom'); }}
                data-testid={`element-btn-${el}`}
                className={[
                  'w-8 h-8 rounded-md font-bold text-xs transition-colors',
                  selectedElement === el && tool === 'atom'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                ].join(' ')}
              >
                {el}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select onValueChange={handlePreset}>
            <SelectTrigger className="w-[148px] h-8 text-sm">
              <SelectValue placeholder="Load preset..." />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(presets).map(k => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={clear} data-testid="btn-clear">Clear</Button>
          <Button variant="secondary" size="sm" onClick={() => setShowAnalysis(!showAnalysis)} data-testid="btn-toggle-analysis">
            {showAnalysis ? 'Hide' : 'Highlight'}
          </Button>
          <Button size="sm" onClick={handleAnalyze} className="font-bold" data-testid="btn-analyze">
            Analyze
          </Button>
        </div>
      </header>

      {/* ── Mobile header ───────────────────────────────────────────────── */}
      <header className="md:hidden flex h-12 border-b border-border px-3 items-center justify-between shrink-0 bg-card">
        <div className="flex items-center gap-1.5">
          <span className="font-bold tracking-tight">ChemName</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm">PRO</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Select onValueChange={handlePreset}>
            <SelectTrigger className="h-8 text-xs w-[100px]">
              <SelectValue placeholder="Preset..." />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(presets).map(k => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={clear}>Clear</Button>
          <Button size="sm" className="h-8 px-3 text-xs font-bold" onClick={handleAnalyze}>Analyze</Button>
        </div>
      </header>

      {/* ── Main workspace ──────────────────────────────────────────────── */}
      <main className="flex-1 flex overflow-hidden min-h-0">

        {/* Left drawing toolbar */}
        <DrawingToolbar
          tool={tool}
          setTool={handleSetTool}
          selectedBondOrder={selectedBondOrder}
          setSelectedBondOrder={setSelectedBondOrder}
          selectedElement={selectedElement}
        />

        {/* Canvas */}
        <div className="flex-1 relative min-h-0 min-w-0">
          <MoleculeCanvas
            selectedElement={selectedElement}
            selectedBondOrder={selectedBondOrder}
            tool={tool}
          />

          {/* Desktop tips */}
          <div className="hidden md:block absolute bottom-4 right-4 p-3 bg-card/80 backdrop-blur border border-border rounded-lg text-xs text-muted-foreground pointer-events-none space-y-0.5">
            {tool === 'move' && <>
              <p><strong>Drag:</strong> Pan canvas</p>
            </>}
            {tool === 'atom' && <>
              <p><strong>Click:</strong> Place {selectedElement} atom</p>
              <p><strong>Drag from atom:</strong> Draw bond</p>
              <p><strong>Right-click atom:</strong> Delete</p>
              <p><strong>Right-click bond:</strong> Cycle order</p>
            </>}
            {tool === 'bond' && <>
              <p><strong>Drag from atom:</strong> Draw bond</p>
              <p><strong>Right-click bond:</strong> Cycle order</p>
              <p><strong>Right-click atom:</strong> Delete</p>
            </>}
          </div>

          {/* Mobile tips */}
          <div className="md:hidden absolute bottom-2 right-3 p-2.5 bg-card/80 backdrop-blur border border-border rounded-lg text-[10px] text-muted-foreground pointer-events-none leading-relaxed">
            {tool === 'move' && <p><strong>Drag:</strong> Pan canvas</p>}
            {tool === 'atom' && <>
              <p><strong>Tap:</strong> Place atom</p>
              <p><strong>Drag from atom:</strong> Bond</p>
              <p><strong>Hold atom:</strong> Delete</p>
            </>}
            {tool === 'bond' && <>
              <p><strong>Drag from atom:</strong> Bond</p>
              <p><strong>Tap bond:</strong> Set order</p>
              <p><strong>Hold atom:</strong> Delete</p>
            </>}
          </div>
        </div>

        {/* Desktop results panel */}
        <div className="hidden md:block">
          <ExplanationPanel />
        </div>
      </main>

      {/* ── Mobile: element + bond toolbar ──────────────────────────────── */}
      <div className="md:hidden shrink-0 border-t border-border bg-card">
        <div className="flex items-center px-2 py-1.5 gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {ELEMENTS.map(el => (
            <button
              key={el}
              onClick={() => { setSelectedElement(el); setTool('atom'); }}
              data-testid={`mobile-element-btn-${el}`}
              className={[
                'shrink-0 w-10 h-10 rounded-md font-bold text-sm transition-colors',
                selectedElement === el && tool === 'atom'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              ].join(' ')}
            >
              {el}
            </button>
          ))}
          <div className="w-px h-8 bg-border shrink-0 mx-1" />
          {/* Analysis toggle */}
          <button
            onClick={() => { setShowAnalysis(!showAnalysis); if (!showAnalysis && namingResult) setShowResults(true); }}
            className={[
              'shrink-0 px-3 h-10 rounded-md text-xs font-semibold whitespace-nowrap transition-colors',
              showAnalysis ? 'bg-blue-600 text-white' : 'bg-muted text-foreground',
            ].join(' ')}
          >
            {showAnalysis ? 'Hide colors' : 'Highlight'}
          </button>
        </div>
      </div>

      {/* ── Mobile: results sheet ────────────────────────────────────────── */}
      {namingResult && (
        <div className="md:hidden shrink-0 border-t border-border bg-card">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm"
            onClick={() => setShowResults(r => !r)}
            data-testid="mobile-results-toggle"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground text-xs uppercase tracking-wider shrink-0">IUPAC</span>
              <span className="font-mono font-bold text-primary truncate">{namingResult.name}</span>
            </span>
            <span className="text-muted-foreground text-xs ml-2 shrink-0">{showResults ? '▼' : '▲'}</span>
          </button>
          {showResults && (
            <div className="max-h-[38vh] overflow-y-auto border-t border-border">
              <ExplanationPanel mobileInline />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
