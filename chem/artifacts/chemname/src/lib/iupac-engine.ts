/**
 * IUPAC Organic Nomenclature Engine
 * Rule-based, graph-traversal implementation following IUPAC 2013 Recommendations.
 * Supports: acyclic, monocyclic, bicyclic, spiro systems.
 * Naming is derived entirely from molecular graph connectivity — never from coordinates.
 */

import { MolecularGraph, NamingResult, ExplanationStep } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// PART 1 — CONSTANTS & TYPES
// ═══════════════════════════════════════════════════════════════════════════════

const CHAIN_PREFIX: string[] = [
  '', 'meth', 'eth', 'prop', 'but', 'pent',
  'hex', 'hept', 'oct', 'non', 'dec',
  'undec', 'dodec', 'tridec', 'tetradec', 'pentadec',
  'hexadec', 'heptadec', 'octadec', 'nonadec', 'icos',
];

const MULTIPLIER: string[] = [
  '', '', 'di', 'tri', 'tetra', 'penta',
  'hexa', 'hepta', 'octa', 'nona', 'deca',
];

/** Use instead of MULTIPLIER when the substituent name itself contains digits or parentheses */
const COMPLEX_MULTIPLIER: string[] = [
  '', '', 'bis', 'tris', 'tetrakis', 'pentakis',
  'hexakis', 'heptakis', 'octakis', 'nonakis', 'decakis',
];

/** IUPAC seniority order for suffix groups — lower index = higher priority */
const FG_SENIORITY: Record<string, number> = {
  carboxylic_acid: 0,
  sulfonic_acid:   1,
  ester:           2,
  acid_halide:     3,
  amide:           4,
  nitrile:         5,
  aldehyde:        6,
  ketone:          7,
  alcohol:         8,
  amine:           9,
  // Expressed as prefixes only — never used as suffix
  ether:           90,
  halo:            90,
  nitro:           90,
  alkane:          99,
};

/** Max valency by element */
const MAX_VALENCY: Record<string, number> = {
  C: 4, N: 3, O: 2, S: 6, P: 5,
  F: 1, Cl: 1, Br: 1, I: 1, H: 1,
};

type FGType =
  | 'carboxylic_acid' | 'sulfonic_acid' | 'ester' | 'acid_halide'
  | 'amide' | 'nitrile' | 'aldehyde' | 'ketone'
  | 'alcohol' | 'amine' | 'ether' | 'halo' | 'nitro' | 'alkane';

interface FunctionalGroup {
  type: FGType;
  /** All atom IDs that belong to this group */
  atomIds: string[];
  /** The carbon in the parent chain that bears this group */
  principalCarbonId: string;
  seniority: number;
  /** For halogens: the element symbol */
  element?: string;
}

interface DirectionScore {
  fgLocants:       number[];
  multipleLocants: number[];
  doubleLocants:   number[];
  tripleLocants:   number[];
  subLocants:      number[];
}

interface SubEntry {
  /** Base name (e.g. "methyl", "chloro") */
  name:    string;
  locant:  number;
  /** Sort key: base name without leading numerics or multipliers */
  sortKey: string;
  atomId:  string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 2 — GRAPH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function getNeighbors(graph: MolecularGraph, atomId: string) {
  return graph.bonds
    .filter(b => b.atom1Id === atomId || b.atom2Id === atomId)
    .map(b => {
      const nId = b.atom1Id === atomId ? b.atom2Id : b.atom1Id;
      const neighbor = graph.atoms.find(a => a.id === nId);
      return neighbor ? { neighbor, bond: b } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

function getBond(graph: MolecularGraph, a: string, b: string) {
  return graph.bonds.find(bd =>
    (bd.atom1Id === a && bd.atom2Id === b) ||
    (bd.atom1Id === b && bd.atom2Id === a)
  ) ?? null;
}

function bondOrderSum(graph: MolecularGraph, atomId: string): number {
  return getNeighbors(graph, atomId).reduce((s, n) => s + n.bond.order, 0);
}

function buildCarbonAdj(graph: MolecularGraph): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const a of graph.atoms) if (a.element === 'C') map.set(a.id, []);
  for (const b of graph.bonds) {
    const a1 = graph.atoms.find(a => a.id === b.atom1Id);
    const a2 = graph.atoms.find(a => a.id === b.atom2Id);
    if (a1?.element === 'C' && a2?.element === 'C') {
      map.get(b.atom1Id)?.push(b.atom2Id);
      map.get(b.atom2Id)?.push(b.atom1Id);
    }
  }
  return map;
}

/** Cycle rank of carbon skeleton = C–C bonds − C atoms + 1 (for connected graph) */
function cycleRankOf(graph: MolecularGraph): number {
  const carbons = graph.atoms.filter(a => a.element === 'C').length;
  const ccBonds = graph.bonds.filter(b => {
    const a1 = graph.atoms.find(a => a.id === b.atom1Id);
    const a2 = graph.atoms.find(a => a.id === b.atom2Id);
    return a1?.element === 'C' && a2?.element === 'C';
  }).length;
  return Math.max(0, ccBonds - carbons + 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 3 — VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function validateStructure(graph: MolecularGraph): string[] {
  const warnings: string[] = [];
  for (const atom of graph.atoms) {
    const sum = bondOrderSum(graph, atom.id);
    const max = MAX_VALENCY[atom.element] ?? 4;
    if (sum > max) {
      warnings.push(`${atom.element} exceeds valency (${sum} > ${max})`);
    }
  }
  // Disconnected fragments
  const carbons = graph.atoms.filter(a => a.element === 'C');
  if (carbons.length > 1) {
    const adj = buildCarbonAdj(graph);
    const visited = new Set<string>();
    const queue = [carbons[0].id];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(...(adj.get(id) ?? []));
    }
    if (visited.size < carbons.length) {
      warnings.push('Disconnected carbon skeleton — name refers to the largest fragment only');
    }
  }
  return warnings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 4 — FUNCTIONAL GROUP DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function detectFunctionalGroups(graph: MolecularGraph): FunctionalGroup[] {
  const groups: FunctionalGroup[] = [];
  const claimedO = new Set<string>();
  const claimedN = new Set<string>();

  /* ── Carbon-based FGs ─────────────────────────────────────────────── */
  for (const atom of graph.atoms) {
    if (atom.element !== 'C') continue;

    const nbrs  = getNeighbors(graph, atom.id);
    const oDbl  = nbrs.filter(n => n.neighbor.element === 'O' && n.bond.order === 2 && !claimedO.has(n.neighbor.id));
    const oSgl  = nbrs.filter(n => n.neighbor.element === 'O' && n.bond.order === 1 && !claimedO.has(n.neighbor.id));
    const nTrpl = nbrs.filter(n => n.neighbor.element === 'N' && n.bond.order === 3 && !claimedN.has(n.neighbor.id));
    const nSgl  = nbrs.filter(n => n.neighbor.element === 'N' && n.bond.order <= 2  && !claimedN.has(n.neighbor.id));
    const cNbrs = nbrs.filter(n => n.neighbor.element === 'C');
    const halNbrs = nbrs.filter(n => ['F','Cl','Br','I'].includes(n.neighbor.element));

    // ── Acid halide C(=O)X ──────────────────────────────────────────
    if (oDbl.length > 0 && halNbrs.length > 0 && oSgl.length === 0 && nSgl.length === 0) {
      claimedO.add(oDbl[0].neighbor.id);
      groups.push({
        type: 'acid_halide', seniority: FG_SENIORITY.acid_halide,
        atomIds: [atom.id, oDbl[0].neighbor.id, halNbrs[0].neighbor.id],
        principalCarbonId: atom.id, element: halNbrs[0].neighbor.element,
      });
      continue;
    }

    // ── Carboxylic acid C(=O)(OH) ────────────────────────────────
    if (oDbl.length > 0 && oSgl.length > 0) {
      const ohO = oSgl.find(o => getNeighbors(graph, o.neighbor.id).length === 1);
      if (ohO) {
        claimedO.add(oDbl[0].neighbor.id); claimedO.add(ohO.neighbor.id);
        groups.push({
          type: 'carboxylic_acid', seniority: FG_SENIORITY.carboxylic_acid,
          atomIds: [atom.id, oDbl[0].neighbor.id, ohO.neighbor.id],
          principalCarbonId: atom.id,
        });
        continue;
      }
    }

    // ── Ester C(=O)O–R ──────────────────────────────────────────
    if (oDbl.length > 0 && oSgl.length > 0) {
      const esterO = oSgl.find(o =>
        getNeighbors(graph, o.neighbor.id).some(n => n.neighbor.element === 'C' && n.neighbor.id !== atom.id)
      );
      if (esterO) {
        claimedO.add(oDbl[0].neighbor.id); claimedO.add(esterO.neighbor.id);
        groups.push({
          type: 'ester', seniority: FG_SENIORITY.ester,
          atomIds: [atom.id, oDbl[0].neighbor.id, esterO.neighbor.id],
          principalCarbonId: atom.id,
        });
        continue;
      }
    }

    // ── Amide C(=O)N ─────────────────────────────────────────────
    if (oDbl.length > 0 && nSgl.length > 0) {
      const nAtom = nSgl[0].neighbor;
      claimedO.add(oDbl[0].neighbor.id); claimedN.add(nAtom.id);
      groups.push({
        type: 'amide', seniority: FG_SENIORITY.amide,
        atomIds: [atom.id, oDbl[0].neighbor.id, nAtom.id],
        principalCarbonId: atom.id,
      });
      continue;
    }

    // ── Nitrile C≡N ──────────────────────────────────────────────
    if (nTrpl.length > 0) {
      const nAtom = nTrpl[0].neighbor;
      if (getNeighbors(graph, nAtom.id).length === 1) {
        claimedN.add(nAtom.id);
        groups.push({
          type: 'nitrile', seniority: FG_SENIORITY.nitrile,
          atomIds: [atom.id, nAtom.id],
          principalCarbonId: atom.id,
        });
        continue;
      }
    }

    // ── Aldehyde: terminal C=O (≤1 C neighbour, no N/OH) ─────────
    if (oDbl.length > 0 && oSgl.length === 0 && nSgl.length === 0 && halNbrs.length === 0 && cNbrs.length <= 1) {
      claimedO.add(oDbl[0].neighbor.id);
      groups.push({
        type: 'aldehyde', seniority: FG_SENIORITY.aldehyde,
        atomIds: [atom.id, oDbl[0].neighbor.id],
        principalCarbonId: atom.id,
      });
      continue;
    }

    // ── Ketone: C=O with ≥2 C neighbours ─────────────────────────
    if (oDbl.length > 0 && oSgl.length === 0 && nSgl.length === 0 && halNbrs.length === 0 && cNbrs.length >= 2) {
      claimedO.add(oDbl[0].neighbor.id);
      groups.push({
        type: 'ketone', seniority: FG_SENIORITY.ketone,
        atomIds: [atom.id, oDbl[0].neighbor.id],
        principalCarbonId: atom.id,
      });
      continue;
    }
  }

  /* ── Sulfonic acid R–S(=O)2–OH ────────────────────────────────── */
  for (const atom of graph.atoms) {
    if (atom.element !== 'S') continue;
    const nbrs = getNeighbors(graph, atom.id);
    const oDbl = nbrs.filter(n => n.neighbor.element === 'O' && n.bond.order === 2);
    const oSgl = nbrs.filter(n => n.neighbor.element === 'O' && n.bond.order === 1 && getNeighbors(graph, n.neighbor.id).length === 1);
    const cNbr = nbrs.find(n => n.neighbor.element === 'C');
    if (oDbl.length >= 2 && oSgl.length >= 1 && cNbr) {
      groups.push({
        type: 'sulfonic_acid', seniority: FG_SENIORITY.sulfonic_acid,
        atomIds: [atom.id, ...oDbl.map(o => o.neighbor.id), oSgl[0].neighbor.id],
        principalCarbonId: cNbr.neighbor.id,
      });
    }
  }

  /* ── Alcohol –OH ─────────────────────────────────────────────── */
  for (const atom of graph.atoms) {
    if (atom.element !== 'O' || claimedO.has(atom.id)) continue;
    const nbrs = getNeighbors(graph, atom.id);
    if (nbrs.length === 1 && nbrs[0].bond.order === 1 && nbrs[0].neighbor.element === 'C') {
      claimedO.add(atom.id);
      groups.push({
        type: 'alcohol', seniority: FG_SENIORITY.alcohol,
        atomIds: [atom.id], principalCarbonId: nbrs[0].neighbor.id,
      });
    }
  }

  /* ── Ether R–O–R ─────────────────────────────────────────────── */
  for (const atom of graph.atoms) {
    if (atom.element !== 'O' || claimedO.has(atom.id)) continue;
    const nbrs = getNeighbors(graph, atom.id);
    if (nbrs.length === 2 && nbrs.every(n => n.neighbor.element === 'C')) {
      claimedO.add(atom.id);
      groups.push({
        type: 'ether', seniority: FG_SENIORITY.ether,
        atomIds: [atom.id], principalCarbonId: nbrs[0].neighbor.id,
      });
    }
  }

  /* ── Amine R–NH2 / R2NH / R3N ─────────────────────────────────── */
  for (const atom of graph.atoms) {
    if (atom.element !== 'N' || claimedN.has(atom.id)) continue;
    const nbrs = getNeighbors(graph, atom.id);
    const cNbrs = nbrs.filter(n => n.neighbor.element === 'C');
    if (cNbrs.length >= 1) {
      claimedN.add(atom.id);
      groups.push({
        type: 'amine', seniority: FG_SENIORITY.amine,
        atomIds: [atom.id], principalCarbonId: cNbrs[0].neighbor.id,
      });
    }
  }

  /* ── Nitro R–NO2 ─────────────────────────────────────────────── */
  for (const atom of graph.atoms) {
    if (atom.element !== 'N') continue;
    const nbrs = getNeighbors(graph, atom.id);
    const oNbrs = nbrs.filter(n => n.neighbor.element === 'O');
    const cNbrs = nbrs.filter(n => n.neighbor.element === 'C');
    if (oNbrs.length === 2 && cNbrs.length === 1) {
      groups.push({
        type: 'nitro', seniority: FG_SENIORITY.nitro,
        atomIds: [atom.id, ...oNbrs.map(o => o.neighbor.id)],
        principalCarbonId: cNbrs[0].neighbor.id,
      });
    }
  }

  /* ── Halogens R–X ────────────────────────────────────────────── */
  for (const atom of graph.atoms) {
    if (!['F','Cl','Br','I'].includes(atom.element)) continue;
    const nbrs = getNeighbors(graph, atom.id);
    if (nbrs.length === 1 && nbrs[0].neighbor.element === 'C') {
      groups.push({
        type: 'halo', seniority: FG_SENIORITY.halo,
        atomIds: [atom.id], principalCarbonId: nbrs[0].neighbor.id,
        element: atom.element,
      });
    }
  }

  return groups;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 5 — CYCLE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/** DFS spanning tree: return all back-edge cycles in carbon skeleton */
function findFundamentalCycles(adjMap: Map<string, string[]>): string[][] {
  const visited = new Set<string>();
  const parent  = new Map<string, string | null>();
  const cycles: string[][] = [];

  function dfs(id: string, par: string | null): void {
    visited.add(id);
    parent.set(id, par);
    for (const nbr of adjMap.get(id) ?? []) {
      if (nbr === par) continue;
      if (visited.has(nbr)) {
        // Back edge → extract cycle
        const cycle: string[] = [id];
        let cur = id;
        while (cur !== nbr) {
          const p = parent.get(cur);
          if (!p) break;
          cycle.push(p);
          cur = p;
        }
        cycles.push(cycle);
      } else {
        dfs(nbr, id);
      }
    }
  }

  for (const id of adjMap.keys()) {
    if (!visited.has(id)) dfs(id, null);
  }

  // Deduplicate: same atom set = same ring
  const seen = new Set<string>();
  return cycles.filter(c => {
    const key = [...c].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

interface RingSystem {
  kind: 'none' | 'mono' | 'bicyclic_bridged' | 'bicyclic_fused' | 'spiro' | 'polycyclic' | 'linked';
  rings: string[][];          // fundamental cycles
  bridgeheads?: string[];     // bridged/fused bicyclic
  spiroAtom?: string;         // spiro
  bridgeLengths?: [number,number,number];  // bicyclo[a.b.c]
}

function analyzeRings(graph: MolecularGraph): RingSystem {
  const rank = cycleRankOf(graph);
  if (rank <= 0) return { kind: 'none', rings: [] };

  const adjMap = buildCarbonAdj(graph);
  const rings   = findFundamentalCycles(adjMap);

  if (rank === 1) return { kind: 'mono', rings };

  if (rank === 2 && rings.length >= 2) {
    const s1 = new Set(rings[0]);
    const s2 = new Set(rings[1]);
    const shared = [...s1].filter(id => s2.has(id));

    if (shared.length === 0) {
      // Two separate rings connected by a single C–C bond (not bicyclic)
      return { kind: 'linked', rings };
    }

    if (shared.length === 1) {
      return { kind: 'spiro', rings, spiroAtom: shared[0] };
    }

    // Bridgeheads = atoms with degree ≥ 3 in carbon skeleton
    const all = new Set([...rings[0], ...rings[1]]);
    const bridgeheads = [...all].filter(id => (adjMap.get(id)?.length ?? 0) >= 3);

    if (bridgeheads.length >= 2) {
      const bh = bridgeheads.slice(0, 2);
      const bridgeLengths = computeBridgeLengths(adjMap, bh, all);
      const kind = bridgeLengths[2] === 0 ? 'bicyclic_fused' : 'bicyclic_bridged';
      return { kind, rings, bridgeheads: bh, bridgeLengths };
    }
  }

  return { kind: 'polycyclic', rings };
}

function computeBridgeLengths(
  adjMap: Map<string, string[]>,
  bridgeheads: string[],
  allRingAtoms: Set<string>
): [number, number, number] {
  const [bh1, bh2] = bridgeheads;

  // Check if bridgeheads are directly bonded (= the zero bridge in fused systems)
  const directBond = adjMap.get(bh1)?.includes(bh2) ?? false;

  // Build adjacency without the direct bh1↔bh2 bond so DFS finds the real bridges
  const adjNoDirect = new Map<string, string[]>();
  for (const [id, nbrs] of adjMap.entries()) {
    if (id === bh1)      adjNoDirect.set(id, nbrs.filter(n => n !== bh2));
    else if (id === bh2) adjNoDirect.set(id, nbrs.filter(n => n !== bh1));
    else                 adjNoDirect.set(id, [...nbrs]);
  }

  // DFS: enumerate ALL simple paths from bh1 to bh2 within ring atoms
  const bridges: number[] = [];
  const visited = new Set<string>([bh1]);

  function dfs(id: string, depth: number): void {
    if (id === bh2) { bridges.push(depth - 1); return; }
    for (const nbr of adjNoDirect.get(id) ?? []) {
      if (!visited.has(nbr) && allRingAtoms.has(nbr)) {
        visited.add(nbr);
        dfs(nbr, depth + 1);
        visited.delete(nbr);
      }
    }
  }
  dfs(bh1, 0);

  if (directBond) bridges.push(0);
  const sorted = [...bridges].sort((a, b) => b - a);
  return [sorted[0] ?? 0, sorted[1] ?? 0, sorted[2] ?? 0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 6 — PARENT CHAIN CANDIDATES
// ═══════════════════════════════════════════════════════════════════════════════

/** All simple paths through carbon atoms, deduped */
function allCarbonPaths(graph: MolecularGraph): string[][] {
  const adjMap = buildCarbonAdj(graph);
  const result: string[][] = [];

  function dfs(id: string, visited: Set<string>, path: string[]): void {
    const next = (adjMap.get(id) ?? []).filter(n => !visited.has(n));
    if (next.length === 0) { result.push([...path]); return; }
    visited.add(id);
    for (const n of next) dfs(n, new Set(visited), [...path, n]);
  }

  for (const id of adjMap.keys()) dfs(id, new Set([id]), [id]);

  const seen = new Set<string>();
  return result.filter(p => {
    const key = [...p].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

type ChainScoreKey = [number, number, number, number];   // [fgCount, multiBonds, length, subCount]

function scoreChain(
  chain: string[], isRing: boolean,
  fgs: FunctionalGroup[], fgExtraIds: Set<string>,
  graph: MolecularGraph
): ChainScoreKey {
  const chainSet = new Set(chain);
  const fgCount = fgs.filter(fg => chainSet.has(fg.principalCarbonId)).length;

  let multiBonds = 0;
  const edges = isRing ? chain.length : chain.length - 1;
  for (let i = 0; i < edges; i++) {
    const bd = getBond(graph, chain[i], chain[(i + 1) % chain.length]);
    if (bd && bd.order >= 2) multiBonds++;
  }

  let subs = 0;
  for (const id of chain) {
    for (const n of getNeighbors(graph, id)) {
      if (!chainSet.has(n.neighbor.id) && !fgExtraIds.has(n.neighbor.id)) subs++;
    }
  }

  return [fgCount, multiBonds, chain.length, subs];
}

function cmpChainScore(a: ChainScoreKey, b: ChainScoreKey): number {
  for (let i = 0; i < a.length; i++) {
    if (b[i] !== a[i]) return b[i] - a[i]; // higher is better
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 7 — NUMBERING
// ═══════════════════════════════════════════════════════════════════════════════

/** Compare locant sets: return <0 if a wins (lower locants). */
function cmpLocants(a: number[], b: number[]): number {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return sa[i] - sb[i];
  }
  return sa.length - sb.length;
}

function computeDirectionScore(
  chain: string[], isRing: boolean,
  seniorFGCarbonIds: string[], fgExtraIds: Set<string>,
  graph: MolecularGraph
): DirectionScore {
  const chainSet = new Set(chain);
  const fgLocants: number[] = [], multipleLocants: number[] = [];
  const doubleLocants: number[] = [], tripleLocants: number[] = [];
  const subLocants: number[] = [];

  const edges = isRing ? chain.length : chain.length - 1;

  for (let i = 0; i < chain.length; i++) {
    const pos = i + 1;
    if (seniorFGCarbonIds.includes(chain[i])) fgLocants.push(pos);

    if (i < edges) {
      const bd = getBond(graph, chain[i], chain[(i + 1) % chain.length]);
      if (bd && bd.order >= 2) {
        multipleLocants.push(pos);
        if (bd.order === 2) doubleLocants.push(pos);
        if (bd.order === 3) tripleLocants.push(pos);
      }
    }

    for (const n of getNeighbors(graph, chain[i])) {
      if (!chainSet.has(n.neighbor.id) && !fgExtraIds.has(n.neighbor.id)) {
        subLocants.push(pos);
      }
    }
  }

  return { fgLocants, multipleLocants, doubleLocants, tripleLocants, subLocants };
}

function chooseBetween(
  fwd: string[], rev: string[], isRing: boolean,
  seniorFGCarbonIds: string[], fgExtraIds: Set<string>,
  graph: MolecularGraph
): { chain: string[]; score: DirectionScore } {
  const sf = computeDirectionScore(fwd, isRing, seniorFGCarbonIds, fgExtraIds, graph);
  const sr = computeDirectionScore(rev, isRing, seniorFGCarbonIds, fgExtraIds, graph);

  const criteria: Array<[number[], number[]]> = [
    [sf.fgLocants, sr.fgLocants],
    [sf.multipleLocants, sr.multipleLocants],
    [sf.doubleLocants, sr.doubleLocants],
    [sf.tripleLocants, sr.tripleLocants],
    [sf.subLocants, sr.subLocants],
  ];

  for (const [a, b] of criteria) {
    const c = cmpLocants(a, b);
    if (c < 0) return { chain: fwd, score: sf };
    if (c > 0) return { chain: rev, score: sr };
  }
  return { chain: fwd, score: sf };
}

/** For rings: try all starting positions and both directions → best numbering */
function bestRingNumbering(
  ring: string[], seniorFGCarbonIds: string[], fgExtraIds: Set<string>, graph: MolecularGraph
): { chain: string[]; score: DirectionScore } {
  let best: { chain: string[]; score: DirectionScore } | null = null;

  for (let start = 0; start < ring.length; start++) {
    const rot = [...ring.slice(start), ...ring.slice(0, start)];
    const rev = [rot[0], ...rot.slice(1).reverse()];
    const cand = chooseBetween(rot, rev, true, seniorFGCarbonIds, fgExtraIds, graph);

    if (!best) { best = cand; continue; }

    const criteria: Array<[number[], number[]]> = [
      [cand.score.fgLocants, best.score.fgLocants],
      [cand.score.multipleLocants, best.score.multipleLocants],
      [cand.score.doubleLocants, best.score.doubleLocants],
      [cand.score.tripleLocants, best.score.tripleLocants],
      [cand.score.subLocants, best.score.subLocants],
    ];

    for (const [a, b] of criteria) {
      const c = cmpLocants(a, b);
      if (c < 0) { best = cand; break; }
      if (c > 0) break;
    }
  }

  return best!;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 8 — SUBSTITUENT NAMING
// ═══════════════════════════════════════════════════════════════════════════════

// ── Substituent helpers ───────────────────────────────────────────────────────

/**
 * Returns the longest simple path starting from `startId`,
 * not visiting any atom in `forbidden`, staying within `branchSet`.
 */
function longestArmFrom(
  startId: string,
  forbidden: Set<string>,
  branchSet: Set<string>,
  graph: MolecularGraph
): string[] {
  const forb = new Set(forbidden);
  forb.add(startId);
  const nexts = getNeighbors(graph, startId)
    .filter(n => branchSet.has(n.neighbor.id) && !forb.has(n.neighbor.id));
  if (nexts.length === 0) return [startId];
  let best: string[] = [];
  for (const n of nexts) {
    const arm = longestArmFrom(n.neighbor.id, forb, branchSet, graph);
    if (arm.length > best.length) best = arm;
  }
  return [startId, ...best];
}

/**
 * DFS-collect all carbon atoms reachable from `startId`
 * without crossing into `forbidden`.
 */
function collectSubAtoms(
  startId: string,
  forbidden: Set<string>,
  branchSet: Set<string>,
  graph: MolecularGraph
): string[] {
  const vis = new Set(forbidden);
  const result: string[] = [];
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    if (vis.has(id)) continue;
    vis.add(id); result.push(id);
    for (const n of getNeighbors(graph, id)) {
      if (branchSet.has(n.neighbor.id) && !vis.has(n.neighbor.id)) stack.push(n.neighbor.id);
    }
  }
  return result;
}

/**
 * Name an alkyl substituent rooted at `rootId` (the atom bonded to the parent chain).
 * Branched substituents are named correctly (propan-2-yl, 2-methylpropyl, etc.)
 * and wrapped in parentheses.
 */
function nameAlkylBranch(rootId: string, parentSet: Set<string>, graph: MolecularGraph): string {
  // Collect all branch carbons
  const vis0 = new Set(parentSet);
  const branchAtoms: string[] = [];
  const stack0 = [rootId];
  while (stack0.length) {
    const id = stack0.pop()!;
    if (vis0.has(id)) continue;
    vis0.add(id); branchAtoms.push(id);
    for (const n of getNeighbors(graph, id)) {
      if (n.neighbor.element === 'C' && !vis0.has(n.neighbor.id)) stack0.push(n.neighbor.id);
    }
  }

  const total = branchAtoms.length;
  if (total === 1) return 'methyl';

  const branchSet = new Set(branchAtoms);

  // Detect cyclic substituent (cycloalkyl group): in a tree edges = atoms-1;
  // if edges >= atoms, the branch contains a ring.
  const branchCCBonds = graph.bonds.filter(b =>
    branchSet.has(b.atom1Id) && branchSet.has(b.atom2Id)
  ).length;
  if (branchCCBonds >= total) {
    const prefix = CHAIN_PREFIX[total];
    return prefix ? `cyclo${prefix}yl` : `(${total}-membered-ring)yl`;
  }

  function cNbrsInBranch(id: string): string[] {
    return getNeighbors(graph, id)
      .filter(n => branchSet.has(n.neighbor.id))
      .map(n => n.neighbor.id);
  }

  // Linear check: root has ≤1 branch-C neighbour AND no internal atom has >2 branch-C neighbours
  const rootNbrs = cNbrsInBranch(rootId);
  const isBranched =
    rootNbrs.length > 1 ||
    branchAtoms.some(id => id !== rootId && cNbrsInBranch(id).length > 2);

  if (!isBranched) {
    if (total < CHAIN_PREFIX.length) return `${CHAIN_PREFIX[total]}yl`;
    return `(${total}-carbon)yl`;
  }

  // ── Branched substituent ──────────────────────────────────────────────────
  // Find the longest simple path through root.
  // Build one arm per neighbour of root, pick the two longest and combine through root.
  const rootForb = new Set(parentSet);
  rootForb.add(rootId);

  const arms: string[][] = rootNbrs.map(nbrId =>
    longestArmFrom(nbrId, rootForb, branchSet, graph)
  );
  arms.sort((a, b) => b.length - a.length); // longest first

  // Place shorter arm before root so root gets the lowest locant.
  let mainChain: string[];
  if (arms.length >= 2) {
    // arms[0] = longer → goes after root; arms[1] = shorter → reversed before root
    mainChain = [...[...arms[1]].reverse(), rootId, ...arms[0]];
  } else if (arms.length === 1) {
    mainChain = [rootId, ...arms[0]];
  } else {
    mainChain = [rootId];
  }

  const rootLocant   = mainChain.indexOf(rootId) + 1;
  const mainChainLen = mainChain.length;
  const mainChainSet = new Set(mainChain);
  const chainPfx     = mainChainLen < CHAIN_PREFIX.length
    ? CHAIN_PREFIX[mainChainLen]
    : `${mainChainLen}C`;

  // Collect sub-substituents (branch atoms not in main chain)
  const subByName = new Map<string, number[]>(); // stem → locants
  for (let i = 0; i < mainChain.length; i++) {
    for (const n of getNeighbors(graph, mainChain[i])) {
      if (branchSet.has(n.neighbor.id) && !mainChainSet.has(n.neighbor.id)) {
        const subAtoms = collectSubAtoms(n.neighbor.id, mainChainSet, branchSet, graph);
        const subLen   = subAtoms.length;
        const subStem  = subLen < CHAIN_PREFIX.length ? `${CHAIN_PREFIX[subLen]}yl` : `${subLen}C-yl`;
        const locant   = i + 1;
        if (!subByName.has(subStem)) subByName.set(subStem, []);
        subByName.get(subStem)!.push(locant);
      }
    }
  }

  // Build sub-substituent prefix string (alphabetical, no trailing hyphen)
  const subParts = [...subByName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stem, locs]) => {
      locs.sort((a, b) => a - b);
      const mult = MULTIPLIER[locs.length] ?? '';
      return `${locs.join(',')}-${mult}${stem}`;
    });
  const subPfxStr = subParts.join('-'); // e.g. "2-methyl" or "1,1-dimethyl"

  // Assemble name
  let result: string;
  if (rootLocant === 1) {
    result = `${subPfxStr}${chainPfx}yl`;
  } else {
    result = `${subPfxStr}${chainPfx}an-${rootLocant}-yl`;
  }
  result = result.replace(/--+/g, '-').replace(/^-/, '').replace(/-$/, '');

  return `(${result})`; // always wrap branched substituents in parentheses
}

function halogPrefix(el: string): string {
  const m: Record<string, string> = { F: 'fluoro', Cl: 'chloro', Br: 'bromo', I: 'iodo' };
  return m[el] ?? el.toLowerCase();
}

function fgAsPrefix(fg: FunctionalGroup): string {
  switch (fg.type) {
    case 'carboxylic_acid': return 'carboxy';
    case 'alcohol':         return 'hydroxy';
    case 'ketone':          return 'oxo';
    case 'aldehyde':        return 'formyl';
    case 'amine':           return 'amino';
    case 'nitro':           return 'nitro';
    case 'ether':           return 'alkoxy';
    case 'halo':            return halogPrefix(fg.element ?? '');
    default:                return '';
  }
}

/** Strip multiplicative prefix for alphabetical sorting */
function sortKey(name: string): string {
  return name
    .replace(/^(bis|tris|tetrakis|pentakis|hexakis|heptakis|octakis|nonakis|decakis|di|tri|tetra|penta|hexa|hepta|octa|nona|deca)/i, '')
    .replace(/^\(/, '')
    .toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 9 — NAME ASSEMBLY
// ═══════════════════════════════════════════════════════════════════════════════

function buildSubstituentPrefix(subs: SubEntry[], isRing = false, hasSuffixFG = false): string {
  if (subs.length === 0) return '';

  const groups = new Map<string, { name: string; locants: number[] }>();
  for (const s of subs) {
    const key = sortKey(s.name);
    if (!groups.has(key)) groups.set(key, { name: s.name, locants: [] });
    groups.get(key)!.locants.push(s.locant);
  }

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Omit locant only on a ring with exactly 1 substituent AND no suffix FG
  const totalCount = subs.length;
  const omitLocant = isRing && totalCount === 1 && !hasSuffixFG;

  const parts = sortedGroups.map(([, { name, locants }]) => {
    locants.sort((a, b) => a - b);
    if (omitLocant) return name;
    // Use bis/tris/… for complex substituent names (those with digits or parentheses)
    const isComplex = /[\d(]/.test(name);
    const mult = isComplex
      ? (COMPLEX_MULTIPLIER[locants.length] ?? `${locants.length}×`)
      : (MULTIPLIER[locants.length] ?? `${locants.length}×`);
    return `${locants.join(',')}-${mult}${name}`;
  });

  return parts.join('-');
}

function formatLocants(locs: number[]): string {
  return [...locs].sort((a, b) => a - b).join(',');
}

/** Build ene/yne infix with locants */
function unsatInfix(doubleBonds: number[], tripleBonds: number[]): string {
  let result = '';
  if (doubleBonds.length > 0) {
    const locs = formatLocants(doubleBonds);
    const mult = MULTIPLIER[doubleBonds.length] ?? '';
    result += `-${locs}-${mult}en`;
  }
  if (tripleBonds.length > 0) {
    const locs = formatLocants(tripleBonds);
    const mult = MULTIPLIER[tripleBonds.length] ?? '';
    result += `-${locs}-${mult}yn`;
  }
  return result;
}

function assembleName(
  isRing: boolean,
  ringSystem: RingSystem,
  basePrefix: string,
  seniorFG: FunctionalGroup | null,
  fgLocant: number | null,
  doubleBonds: number[],
  tripleBonds: number[],
  subs: SubEntry[],
  hasOtherGroups: boolean       // true when other substituents/FG prefixes are present
): string {
  const hasUnsaturation = doubleBonds.length > 0 || tripleBonds.length > 0;
  const hasSuffixFG = seniorFG !== null;
  const subPfx = buildSubstituentPrefix(subs, isRing, hasSuffixFG);
  const unsat = unsatInfix(doubleBonds, tripleBonds);
  const ringPfx = isRing ? 'cyclo' : '';
  // Include the FG locant in the suffix only when other groups are also present
  const showFGLocant = hasOtherGroups && fgLocant != null;

  if (!seniorFG) {
    if (!hasUnsaturation) return clean(`${subPfx}${ringPfx}${basePrefix}ane`);
    return clean(`${subPfx}${ringPfx}${basePrefix}${unsat}e`);
  }

  const loc = fgLocant;

  switch (seniorFG.type) {
    case 'carboxylic_acid':
      if (isRing) {
        const fgLocStr = showFGLocant ? `-${loc}` : '';
        return clean(`${subPfx}cyclo${basePrefix}ane${fgLocStr}-carboxylic acid`);
      }
      if (hasUnsaturation) return clean(`${subPfx}${basePrefix}${unsat}oic acid`);
      return clean(`${subPfx}${basePrefix}anoic acid`);

    case 'sulfonic_acid':
      return clean(`${subPfx}${ringPfx}${basePrefix}anesulfonic acid`);

    case 'ester':
      if (hasUnsaturation) return clean(`${subPfx}${ringPfx}${basePrefix}${unsat}oate`);
      return clean(`${subPfx}${ringPfx}${basePrefix}anoate`);

    case 'acid_halide': {
      const halSuffix = seniorFG.element === 'Cl' ? 'oyl chloride'
                      : seniorFG.element === 'Br' ? 'oyl bromide'
                      : seniorFG.element === 'F'  ? 'oyl fluoride'
                      : 'oyl iodide';
      return clean(`${subPfx}${ringPfx}${basePrefix}an${halSuffix}`);
    }

    case 'amide':
      if (hasUnsaturation) return clean(`${subPfx}${ringPfx}${basePrefix}${unsat}amide`);
      return clean(`${subPfx}${ringPfx}${basePrefix}anamide`);

    case 'nitrile':
      if (hasUnsaturation) return clean(`${subPfx}${ringPfx}${basePrefix}${unsat}enitrile`);
      return clean(`${subPfx}${ringPfx}${basePrefix}anenitrile`);

    case 'aldehyde':
      if (isRing) {
        // CHO attached to ring carbon → -carbaldehyde (always at C1, no locant printed)
        return clean(`${subPfx}cyclo${basePrefix}anecarbaldehyde`);
      }
      // Acyclic: C1 is the CHO carbon → suffix -al, no locant
      if (hasUnsaturation) return clean(`${subPfx}${basePrefix}${unsat}al`);
      return clean(`${subPfx}${basePrefix}anal`);

    case 'ketone': {
      const locStr = showFGLocant ? `-${loc}` : '';
      if (hasUnsaturation) return clean(`${subPfx}${ringPfx}${basePrefix}${unsat}an${locStr}-one`);
      return clean(`${subPfx}${ringPfx}${basePrefix}an${locStr}-one`);
    }

    case 'alcohol': {
      const locStr = showFGLocant ? `-${loc}` : '';
      if (hasUnsaturation) return clean(`${subPfx}${ringPfx}${basePrefix}${unsat}an${locStr}-ol`);
      return clean(`${subPfx}${ringPfx}${basePrefix}an${locStr}-ol`);
    }

    case 'amine': {
      const locStr = showFGLocant ? `-${loc}` : '';
      if (hasUnsaturation) return clean(`${subPfx}${ringPfx}${basePrefix}${unsat}an${locStr}-amine`);
      return clean(`${subPfx}${ringPfx}${basePrefix}an${locStr}-amine`);
    }

    default:
      if (!hasUnsaturation) return clean(`${subPfx}${ringPfx}${basePrefix}ane`);
      return clean(`${subPfx}${ringPfx}${basePrefix}${unsat}e`);
  }
}

/** Clean up artefact dashes and stray hyphens before suffixes */
function clean(s: string): string {
  return s
    .replace(/--+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '')
    .replace(/ane-ol/g, 'an-ol')
    .replace(/ane-one/g, 'an-one')
    .replace(/ane-amine/g, 'an-amine')
    // Remove stray hyphen before suffix when no locant is present
    .replace(/an-ol\b/g, 'anol')
    .replace(/an-one\b/g, 'anone')
    .replace(/an-amine\b/g, 'anamine');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 10 — MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

export function generateIUPACName(graph: MolecularGraph): NamingResult {
  const steps: ExplanationStep[] = [];
  const push = (title: string, detail: string) => steps.push({ title, detail });

  /* ── Empty molecule ─────────────────────────────────────────────── */
  if (graph.atoms.length === 0) {
    return empty();
  }

  /* ── STEP 1 & 2: Validate + detect FGs (FG detection needed to filter ester warning) ── */
  const warnings = validateStructure(graph);

  const carbons = graph.atoms.filter(a => a.element === 'C');
  if (carbons.length === 0) {
    return { ...empty(), name: 'Unknown (no carbon atoms)', warnings };
  }

  /* ── STEP 2: Detect functional groups ───────────────────────────── */
  const allFGs = detectFunctionalGroups(graph);

  // Suppress "disconnected carbon skeleton" for esters before logging validation
  // (the two carbon parts are intentionally bridged through oxygen)
  if (allFGs.some(fg => fg.type === 'ester')) {
    const idx = warnings.findIndex(w => w.toLowerCase().includes('disconnected'));
    if (idx >= 0) warnings.splice(idx, 1);
  }

  if (warnings.length) push('Validation', warnings.join('; '));

  push('Functional Groups Detected',
    allFGs.length > 0
      ? allFGs.map(fg => `${fg.type.replace(/_/g,' ')} (C: ${shortId(fg.principalCarbonId)})`).join(', ')
      : 'None'
  );

  /* ── STEP 3: Principal functional group ─────────────────────────── */
  const suffixFGs = allFGs.filter(fg => fg.seniority < 90);  // exclude prefix-only
  const seniorFG  = suffixFGs.length
    ? suffixFGs.reduce((best, fg) => fg.seniority < best.seniority ? fg : best)
    : null;

  push('Principal Functional Group',
    seniorFG
      ? `${seniorFG.type.replace(/_/g,' ')} (seniority ${seniorFG.seniority}) → suffix`
      : 'None — name as hydrocarbon'
  );

  // All FG extra atom IDs (not the principal C, but the heteroatoms)
  const fgExtraIds = new Set<string>(allFGs.flatMap(fg => fg.atomIds.filter(id => {
    const a = graph.atoms.find(x => x.id === id);
    return a && a.element !== 'C';
  })));

  const seniorFGCarbonIds: string[] = seniorFG ? [seniorFG.principalCarbonId] : [];

  /* ── STEP 4: Ring analysis ──────────────────────────────────────── */
  const ringSystem = analyzeRings(graph);
  push('Ring Analysis', describeRingSystem(ringSystem));

  /* ── STEP 5: Find parent candidates ────────────────────────────── */
  let finalChain: string[];
  let isRing = false;
  let parentDesc = '';

  if (ringSystem.kind === 'none') {
    /* Acyclic: find best chain */
    let candidates = allCarbonPaths(graph);

    // Filter: must include senior FG carbon if present
    if (seniorFG) {
      const withFG = candidates.filter(c => c.includes(seniorFG.principalCarbonId));
      if (withFG.length > 0) candidates = withFG;
    }

    candidates.sort((a, b) =>
      cmpChainScore(
        scoreChain(a, false, suffixFGs, fgExtraIds, graph),
        scoreChain(b, false, suffixFGs, fgExtraIds, graph)
      )
    );

    const best = candidates[0];
    push('Parent Chain Selected',
      `${best.length}-carbon chain chosen from ${candidates.length} candidate(s). ` +
      describeChainScore(scoreChain(best, false, suffixFGs, fgExtraIds, graph))
    );

    // Choose numbering direction
    const { chain, score } = chooseBetween(
      best, [...best].reverse(), false,
      seniorFGCarbonIds, fgExtraIds, graph
    );
    finalChain = chain;
    push('Numbering Direction',
      `Direction chosen to minimise locants. ` +
      `FG: [${score.fgLocants.join(',')}] | ` +
      `Mult.bonds: [${score.multipleLocants.join(',')}] | ` +
      `Subs: [${score.subLocants.join(',')}]`
    );

  } else if (ringSystem.kind === 'mono') {
    /* Monocyclic */
    isRing = true;
    const ring = ringSystem.rings[0];

    const { chain, score } = bestRingNumbering(ring, seniorFGCarbonIds, fgExtraIds, graph);
    finalChain = chain;
    push('Parent Ring Selected',
      `${ring.length}-membered ring. Numbering chosen: FG:[${score.fgLocants}] | ` +
      `Mult:[${score.multipleLocants}] | Subs:[${score.subLocants}]`
    );

  } else if (ringSystem.kind === 'linked') {
    /* Two rings connected by a single bond — larger ring is parent, smaller becomes cycloalkyl substituent */
    isRing = true;
    const sorted = [...ringSystem.rings].sort((a, b) => b.length - a.length);
    const parentRing = sorted[0];
    const smallerRing = sorted[1];
    const { chain, score } = bestRingNumbering(parentRing, seniorFGCarbonIds, fgExtraIds, graph);
    finalChain = chain;
    push('Parent Ring (Linked System)',
      `Larger ring (${parentRing.length}-membered) chosen as parent; ` +
      `smaller ring (${smallerRing.length}-membered) becomes cycloalkyl substituent. ` +
      `FG:[${score.fgLocants}] | Subs:[${score.subLocants}]`
    );

  } else if (ringSystem.kind === 'spiro' && ringSystem.spiroAtom) {
    /* Spiro: treat as linear chain through spiro atom */
    isRing = false;
    const r1 = ringSystem.rings[0];
    const r2 = ringSystem.rings[1];
    const sa  = ringSystem.spiroAtom;
    const others1 = r1.filter(id => id !== sa);
    const others2 = r2.filter(id => id !== sa);
    finalChain = [...others1, sa, ...others2];
    const a = others1.length;
    const b = others2.length;
    const totalC = finalChain.length;
    const prefix = CHAIN_PREFIX[totalC] ?? `${totalC}C`;
    const name = `spiro[${Math.min(a,b)}.${Math.max(a,b)}]${prefix}ane`;
    push('Spiro System', `spiro[${a}.${b}]: ${name}`);
    return buildResult(name, steps, finalChain, allFGs, seniorFG, [], warnings, new Map());

  } else if ((ringSystem.kind === 'bicyclic_bridged' || ringSystem.kind === 'bicyclic_fused') && ringSystem.bridgeheads) {
    /* Bicyclic */
    isRing = false;
    const allRingAtoms = new Set([...ringSystem.rings[0], ...ringSystem.rings[1]]);
    const [a, b, c] = ringSystem.bridgeLengths ?? [0, 0, 0];
    const totalC = allRingAtoms.size;
    const prefix = CHAIN_PREFIX[totalC] ?? `${totalC}C`;
    const name = `bicyclo[${a}.${b}.${c}]${prefix}ane`;
    push('Bicyclic System', `bicyclo[${a}.${b}.${c}]: ${name}`);
    // Use all ring atoms as chain for highlight purposes
    finalChain = [...allRingAtoms];
    return buildResult(name, steps, finalChain, allFGs, seniorFG, [], warnings, new Map());

  } else {
    /* Polycyclic: fallback to longest chain */
    isRing = false;
    let candidates = allCarbonPaths(graph);
    candidates.sort((a, b) => b.length - a.length);
    const { chain } = chooseBetween(
      candidates[0], [...candidates[0]].reverse(), false,
      seniorFGCarbonIds, fgExtraIds, graph
    );
    finalChain = chain;
    push('Polycyclic (simplified)', 'Treating longest chain as parent');
  }

  /* ── STEP 6: Numbering map ──────────────────────────────────────── */
  const numbering = new Map<string, number>();
  finalChain.forEach((id, i) => numbering.set(id, i + 1));

  /* ── STEP 7: Unsaturation (C=C, C≡C) ───────────────────────────── */
  const chainSet = new Set(finalChain);
  const doubleBonds: number[] = [];
  const tripleBonds: number[] = [];
  const edges = isRing ? finalChain.length : finalChain.length - 1;

  for (let i = 0; i < edges; i++) {
    const bd = getBond(graph, finalChain[i], finalChain[(i + 1) % finalChain.length]);
    if (bd?.order === 2) doubleBonds.push(i + 1);
    if (bd?.order === 3) tripleBonds.push(i + 1);
  }

  if (doubleBonds.length || tripleBonds.length) {
    push('Unsaturation',
      [
        doubleBonds.length ? `Double bond(s) at: ${doubleBonds.join(', ')} (ene)` : '',
        tripleBonds.length ? `Triple bond(s) at: ${tripleBonds.join(', ')} (yne)` : '',
      ].filter(Boolean).join('; ')
    );
  }

  /* ── STEP 8: Substituents ───────────────────────────────────────── */
  const fgAtomIds = new Set<string>(allFGs.flatMap(fg => fg.atomIds));
  const subEntries: SubEntry[] = [];
  const subAtomIds: string[] = [];

  // Dedup helper: avoid adding the same (locant, name) pair twice
  const addPrefix = (name: string, locant: number, atomId: string) => {
    if (name && !subEntries.some(s => s.locant === locant && s.name === name)) {
      subEntries.push({ name, locant, sortKey: sortKey(name), atomId });
      subAtomIds.push(atomId);
    }
  };

  for (let i = 0; i < finalChain.length; i++) {
    const id = finalChain[i];
    const locant = numbering.get(id)!;

    for (const n of getNeighbors(graph, id)) {
      const nbr = n.neighbor;
      if (chainSet.has(nbr.id)) continue;

      // Heteroatom claimed by any FG (fgExtraIds = non-carbon FG atoms)
      if (fgExtraIds.has(nbr.id)) {
        // Add as prefix if it belongs to a non-senior FG
        const parentFG = allFGs.find(fg => fg.atomIds.includes(nbr.id) && fg !== seniorFG);
        if (parentFG) {
          addPrefix(fgAsPrefix(parentFG), locant, nbr.id);
        }
        continue;
      }

      // Atom that belongs to the senior FG — skip (already handled as suffix)
      if (seniorFG && seniorFG.atomIds.includes(nbr.id)) continue;

      if (nbr.element === 'C') {
        // Check whether this carbon is the principal atom of a non-senior FG
        // (e.g. COOH or CHO group attached to a ring carbon)
        const parentFG = allFGs.find(fg => fg.atomIds.includes(nbr.id) && fg !== seniorFG);
        if (parentFG) {
          addPrefix(fgAsPrefix(parentFG), locant, nbr.id);
        } else {
          // Regular alkyl/cycloalkyl substituent
          const name = nameAlkylBranch(nbr.id, chainSet, graph);
          subEntries.push({ name, locant, sortKey: sortKey(name), atomId: nbr.id });
          subAtomIds.push(nbr.id);
        }
      } else if (!fgAtomIds.has(nbr.id)) {
        // Bare heteroatom not claimed by any FG (e.g. free halogen)
        const pref = halogPrefix(nbr.element) || nbr.element.toLowerCase();
        subEntries.push({ name: pref, locant, sortKey: sortKey(pref), atomId: nbr.id });
        subAtomIds.push(nbr.id);
      } else {
        // Non-carbon atom claimed by a non-senior FG (shouldn't normally reach here
        // since fgExtraIds covers non-C FG atoms, but handle defensively)
        const parentFG = allFGs.find(fg => fg.atomIds.includes(nbr.id) && fg !== seniorFG);
        if (parentFG) addPrefix(fgAsPrefix(parentFG), locant, nbr.id);
      }
    }
  }

  // Alphabetize (ignoring multiplier prefixes)
  subEntries.sort((a, b) => {
    const c = a.sortKey.localeCompare(b.sortKey);
    return c !== 0 ? c : a.locant - b.locant;
  });

  if (subEntries.length) {
    push('Substituents (alphabetized)',
      subEntries.map(s => `${s.locant}-${s.name}`).join(', ')
    );
  }

  /* ── STEP 9: FG locant ──────────────────────────────────────────── */
  const fgLocant = seniorFG ? (numbering.get(seniorFG.principalCarbonId) ?? null) : null;

  /* ── STEP 10: Assemble name ─────────────────────────────────────── */
  const n = finalChain.length;
  const basePrefix = CHAIN_PREFIX[n] ?? `${n}C`;

  // hasOtherGroups = true when substituents or FG-prefix groups exist alongside the suffix
  const hasOtherGroups = subEntries.length > 0;

  // Special case: ester — name as "[alkyl] [acyl]anoate"
  if (seniorFG?.type === 'ester') {
    // Find the ester bridging oxygen (single-bonded O with a C on each side)
    const esterOId = seniorFG.atomIds.find(id => {
      const a = graph.atoms.find(x => x.id === id);
      if (!a || a.element !== 'O') return false;
      const cNbrs = getNeighbors(graph, id).filter(nb => nb.neighbor.element === 'C');
      return cNbrs.length >= 2; // bonded to both acyl-C and alkyl-C
    });
    // Find the alkyl carbon on the oxygen's far side (not the acyl principal carbon)
    const alkylCId = esterOId
      ? getNeighbors(graph, esterOId)
          .find(nb => nb.neighbor.element === 'C' && nb.neighbor.id !== seniorFG.principalCarbonId)
          ?.neighbor.id
      : null;
    const alkylName = alkylCId
      ? nameAlkylBranch(alkylCId, new Set(), graph)
      : 'methyl';
    const acylPart = assembleName(false, ringSystem, basePrefix, seniorFG, fgLocant, doubleBonds, tripleBonds, subEntries, hasOtherGroups);
    const finalName = `${alkylName} ${acylPart}`;
    push('Final IUPAC Name', finalName);
    return buildResult(finalName, steps, finalChain, allFGs, seniorFG, subAtomIds, warnings, numbering);
  }

  const finalName = assembleName(
    isRing, ringSystem, basePrefix,
    seniorFG, fgLocant,
    doubleBonds, tripleBonds,
    subEntries,
    hasOtherGroups
  );

  push('Final IUPAC Name', finalName);

  return buildResult(
    finalName, steps, finalChain, allFGs, seniorFG,
    subAtomIds, warnings, numbering
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function empty(): NamingResult {
  return {
    name: '', explanation: [], parentChainAtomIds: [],
    functionalGroupAtomIds: [], substituentAtomIds: [],
    warnings: [], numbering: new Map(),
  };
}

function buildResult(
  name: string, explanation: ExplanationStep[],
  parentChainAtomIds: string[], allFGs: FunctionalGroup[],
  seniorFG: FunctionalGroup | null, subAtomIds: string[] | string[][],
  warnings: string[] | Map<string, number>, numbering: Map<string, number> | string[]
): NamingResult {
  // Handle overloaded signatures from spiro/bicyclic shortcuts
  const realSubs   = Array.isArray(subAtomIds[0]) ? [] : subAtomIds as string[];
  const realWarn   = warnings instanceof Map ? [] : warnings as string[];
  const realNum    = numbering instanceof Map ? numbering : new Map<string, number>();

  const fgAtomIds = allFGs.flatMap(fg => fg.atomIds);

  return {
    name, explanation,
    parentChainAtomIds,
    functionalGroupAtomIds: [...new Set(fgAtomIds)],
    substituentAtomIds: realSubs,
    warnings: realWarn,
    numbering: realNum,
  };
}

function shortId(id: string): string { return id.slice(0, 6); }

function describeRingSystem(rs: RingSystem): string {
  switch (rs.kind) {
    case 'none':             return 'Acyclic (no rings detected)';
    case 'mono':             return `Monocyclic: ${rs.rings[0]?.length}-membered ring`;
    case 'bicyclic_bridged': return `Bridged bicyclic: bridgehead atoms [${rs.bridgeheads?.map(shortId).join(', ')}]`;
    case 'bicyclic_fused':   return `Fused bicyclic (decalin-type)`;
    case 'spiro':            return `Spiro: spiro atom ${shortId(rs.spiroAtom ?? '')}`;
    case 'linked':           return `Linked rings: ${rs.rings.map(r => `${r.length}-membered`).join(' + ')} connected by a bond`;
    case 'polycyclic':       return `Polycyclic (${rs.rings.length} rings)`;
    default:                 return 'Unknown';
  }
}

function describeChainScore(s: [number,number,number,number]): string {
  return `FGs: ${s[0]}, MultiBonds: ${s[1]}, Length: ${s[2]}, Subs: ${s[3]}`;
}
