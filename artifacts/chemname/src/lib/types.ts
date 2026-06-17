export interface Atom {
  id: string;
  element: string; // 'C', 'O', 'N', etc.
  x: number;
  y: number;
  charge?: number;
}

export interface Bond {
  id: string;
  atom1Id: string;
  atom2Id: string;
  order: 1 | 2 | 3;
}

export interface MolecularGraph {
  atoms: Atom[];
  bonds: Bond[];
}

export interface ExplanationStep {
  title: string;
  detail: string;
}

export interface NamingResult {
  name: string;
  explanation: ExplanationStep[];
  parentChainAtomIds: string[];
  functionalGroupAtomIds: string[];
  substituentAtomIds: string[];
  warnings: string[];
  numbering: Map<string, number>;
}
