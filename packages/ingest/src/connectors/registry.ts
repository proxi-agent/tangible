import type { Connector } from '../connector.js';
import { collinConnector } from './collin.js';
import { dcadConnector } from './dcad.js';
import { tadConnector } from './tad.js';
import { hcadConnector } from './hcad.js';
import { floridaConnectors } from './florida.js';

/**
 * Every jurisdiction we can ingest. Adding a county means adding a connector
 * here — nothing downstream changes, because the canonical account-year shape
 * is the only contract the rest of the system knows about.
 *
 * Texas is one connector per county because each appraisal district invents its
 * own layout. Florida is 67 instances of one connector because the state
 * reformats every county onto a single schema before publishing it.
 */
const CONNECTORS: readonly Connector[] = [
  hcadConnector,
  dcadConnector,
  collinConnector,
  tadConnector,
  ...floridaConnectors,
];

export function listConnectors(): readonly Connector[] {
  return CONNECTORS;
}

export function getConnector(connectorId: string): Connector | null {
  return CONNECTORS.find((c) => c.id === connectorId) ?? null;
}

export function getConnectorForJurisdiction(jurisdictionId: string): Connector | null {
  return CONNECTORS.find((c) => c.jurisdiction.id === jurisdictionId) ?? null;
}

export function listJurisdictions() {
  return CONNECTORS.map((c) => c.jurisdiction);
}
