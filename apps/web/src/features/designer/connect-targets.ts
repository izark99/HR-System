/**
 * Keyboard edge linking (spec §15 "Bàn phím", AC-UI-76): which edges the "Nối tới…" menu offers
 * from a node. Uses the Designer's own connection check (`connectProblem`: unknown port, port
 * already taken, cycle, self), so the menu never offers an edge a mouse drop would refuse.
 */
import { inputPortsOf, outputPortsOf } from './catalog';
import { connectProblem, type DEdge, type DesignerDoc, type DNode } from './model';
import { foldText } from '../../components/select-logic';

export interface TargetGroup {
  node: DNode;
  /** Input ports of `node` that `from.fromPort` may be connected to now. */
  ports: string[];
}

/** Output ports of a node (step 1 of the menu when there is more than one). */
export function sourcePorts(node: DNode): string[] {
  return outputPortsOf(node.type).map((p) => p.name);
}

/**
 * Target ports grouped by node, in canvas order: every input port except those already connected
 * or that would close a cycle; the source node itself is left out.
 */
export function connectTargets(doc: DesignerDoc, from: string, fromPort: string): TargetGroup[] {
  const out: TargetGroup[] = [];
  for (const node of doc.nodes) {
    if (node.id === from) continue;
    const ports = inputPortsOf(node.type, node.config)
      .map((p) => p.name)
      .filter((toPort) => connectProblem(doc, { from, fromPort, to: node.id, toPort }) === null);
    if (ports.length > 0) out.push({ node, ports });
  }
  return out;
}

/** Edge of a target option. */
export function edgeOf(from: string, fromPort: string, to: string, toPort: string): DEdge {
  return { from, fromPort, to, toPort };
}

/**
 * Search (case- and accent-insensitive, as the Select): a group stays whole when its node name
 * matches, otherwise only the ports whose label matches.
 */
export function filterTargets(
  groups: readonly TargetGroup[],
  query: string,
  nodeLabel: (n: DNode) => string,
  portLabel: (port: string) => string,
): TargetGroup[] {
  const q = foldText(query);
  if (!q) return [...groups];
  return groups
    .map((g) =>
      foldText(`${nodeLabel(g.node)} ${g.node.id}`).includes(q)
        ? g
        : { ...g, ports: g.ports.filter((p) => foldText(`${p} ${portLabel(p)}`).includes(q)) },
    )
    .filter((g) => g.ports.length > 0);
}
