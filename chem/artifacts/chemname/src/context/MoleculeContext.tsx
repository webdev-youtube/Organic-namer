import React, { createContext, useContext, useState, ReactNode } from 'react';
import { MolecularGraph, Atom, Bond, NamingResult } from '../lib/types';
import { generateIUPACName } from '../lib/iupac-engine';

interface MoleculeContextType {
  graph: MolecularGraph;
  setGraph: (graph: MolecularGraph) => void;
  addAtom: (atom: Atom) => void;
  addBond: (bond: Bond) => void;
  removeAtom: (id: string) => void;
  cycleBond: (id: string) => void;
  setBondOrder: (id: string, order: 1|2|3) => void;
  clear: () => void;
  namingResult: NamingResult | null;
  analyze: () => void;
  showAnalysis: boolean;
  setShowAnalysis: (val: boolean) => void;
}

const MoleculeContext = createContext<MoleculeContextType | undefined>(undefined);

export function MoleculeProvider({ children }: { children: ReactNode }) {
  const [graph, setGraph] = useState<MolecularGraph>({ atoms: [], bonds: [] });
  const [namingResult, setNamingResult] = useState<NamingResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const addAtom = (atom: Atom) => setGraph(prev => ({ ...prev, atoms: [...prev.atoms, atom] }));
  
  const addBond = (bond: Bond) => setGraph(prev => ({ ...prev, bonds: [...prev.bonds, bond] }));

  const removeAtom = (id: string) => setGraph(prev => ({
    atoms: prev.atoms.filter(a => a.id !== id),
    bonds: prev.bonds.filter(b => b.atom1Id !== id && b.atom2Id !== id)
  }));

  const cycleBond = (id: string) => setGraph(prev => ({
    ...prev,
    bonds: prev.bonds.map(b => {
      if (b.id === id) {
        return { ...b, order: b.order === 3 ? 1 : (b.order + 1) as 1|2|3 };
      }
      return b;
    })
  }));

  const setBondOrder = (id: string, order: 1|2|3) => setGraph(prev => ({
    ...prev,
    bonds: prev.bonds.map(b => b.id === id ? { ...b, order } : b)
  }));

  const clear = () => {
    setGraph({ atoms: [], bonds: [] });
    setNamingResult(null);
    setShowAnalysis(false);
  };

  const analyze = () => {
    const result = generateIUPACName(graph);
    setNamingResult(result);
    setShowAnalysis(true);
  };

  return (
    <MoleculeContext.Provider value={{
      graph, setGraph, addAtom, addBond, removeAtom, cycleBond, setBondOrder, clear,
      namingResult, analyze, showAnalysis, setShowAnalysis
    }}>
      {children}
    </MoleculeContext.Provider>
  );
}

export function useMolecule() {
  const context = useContext(MoleculeContext);
  if (!context) throw new Error("useMolecule must be used within MoleculeProvider");
  return context;
}
