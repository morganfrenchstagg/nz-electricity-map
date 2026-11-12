import type { Substation, SubstationNode } from '../types'

// The substations a node shows, one or several
export function substationsOf(node: SubstationNode): Substation[] {
  return node.kind === 'substation' ? [node.substation] : node.substations
}

// The node's title: one substation's name, two's, or the first's and how many more
export function substationsTitle(substations: Substation[]): string {
  if (substations.length === 1) return `${substations[0].description} Substation`
  const names = substations.length === 2
    ? substations.map((s) => s.description).join(', ')
    : `${substations[0].description} +${substations.length - 1} more`
  return `${names} Substations`
}
