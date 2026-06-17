import { MolecularGraph } from "./types";

export const presets: Record<string, MolecularGraph> = {
  "Ethanol": {
    atoms: [
      { id: "a1", element: "C", x: 200, y: 200 },
      { id: "a2", element: "C", x: 250, y: 171 },
      { id: "a3", element: "O", x: 300, y: 200 }
    ],
    bonds: [
      { id: "b1", atom1Id: "a1", atom2Id: "a2", order: 1 },
      { id: "b2", atom1Id: "a2", atom2Id: "a3", order: 1 }
    ]
  },
  "Propan-2-one": {
    atoms: [
      { id: "a1", element: "C", x: 200, y: 200 },
      { id: "a2", element: "C", x: 250, y: 171 },
      { id: "a3", element: "C", x: 300, y: 200 },
      { id: "a4", element: "O", x: 250, y: 110 }
    ],
    bonds: [
      { id: "b1", atom1Id: "a1", atom2Id: "a2", order: 1 },
      { id: "b2", atom1Id: "a2", atom2Id: "a3", order: 1 },
      { id: "b3", atom1Id: "a2", atom2Id: "a4", order: 2 }
    ]
  },
  "Butane": {
    atoms: [
      { id: "c1", element: "C", x: 150, y: 200 },
      { id: "c2", element: "C", x: 200, y: 171 },
      { id: "c3", element: "C", x: 250, y: 200 },
      { id: "c4", element: "C", x: 300, y: 171 }
    ],
    bonds: [
      { id: "b1", atom1Id: "c1", atom2Id: "c2", order: 1 },
      { id: "b2", atom1Id: "c2", atom2Id: "c3", order: 1 },
      { id: "b3", atom1Id: "c3", atom2Id: "c4", order: 1 }
    ]
  },
  "Hex-1-ene": {
    atoms: [
      { id: "c1", element: "C", x: 150, y: 200 },
      { id: "c2", element: "C", x: 200, y: 171 },
      { id: "c3", element: "C", x: 250, y: 200 },
      { id: "c4", element: "C", x: 300, y: 171 },
      { id: "c5", element: "C", x: 350, y: 200 },
      { id: "c6", element: "C", x: 400, y: 171 }
    ],
    bonds: [
      { id: "b1", atom1Id: "c1", atom2Id: "c2", order: 2 },
      { id: "b2", atom1Id: "c2", atom2Id: "c3", order: 1 },
      { id: "b3", atom1Id: "c3", atom2Id: "c4", order: 1 },
      { id: "b4", atom1Id: "c4", atom2Id: "c5", order: 1 },
      { id: "b5", atom1Id: "c5", atom2Id: "c6", order: 1 }
    ]
  }
};
